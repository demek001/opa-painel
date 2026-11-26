// USA.b — página de agendamento (etapa 3). JavaScript puro, sem dependências.
// Fluxo: serviços → dia → horário (reserva de 10 min) → seus dados e resumo → confirmado.
// Se a API ou o banco falharem, a página oferece "Agende pelo WhatsApp da barbearia" (D21).
(function () {
  "use strict";

  const CFG = window.USAB_CONFIG || {};
  const API = new URL(CFG.api || "/api/agenda", location.href).toString();
  const FUSO = "America/Sao_Paulo";
  const $tela = document.getElementById("tela");
  const $app = document.getElementById("app");
  // append() escreveria "null" na tela: nulos e false ficam de fora.
  function anexar(...n) { $tela.append(...n.flat().filter((x) => x != null && x !== false)); }

  // ------------------------------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------------------------------

  /** Cria elementos sem innerHTML: textos sempre como texto. */
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style") el.setAttribute("style", v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const f of filhos.flat()) if (f != null && f !== false) el.append(f instanceof Node ? f : String(f));
    return el;
  }

  const guardar = {
    ler(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
    gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* aparelho sem armazenamento */ } },
    apagar(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
  };

  const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  function duracao(min) {
    if (min < 60) return `${min} min`;
    const r = min % 60;
    return `${Math.floor(min / 60)}h${r ? String(r).padStart(2, "0") : ""}`;
  }
  function dataUtc(data) { const [y, m, d] = data.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); }
  const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function diaLongo(data) {
    return maiuscula(dataUtc(data).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }));
  }
  function diaCurto(data) {
    const d = dataUtc(data);
    const sem = d.toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short" }).replace(".", "");
    const mes = d.toLocaleDateString("pt-BR", { timeZone: "UTC", month: "short" }).replace(".", "");
    return `${maiuscula(sem)}, ${d.getUTCDate()} ${mes}`;
  }
  const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: FUSO });
  const amanha = () => new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: FUSO });
  function rotuloDia(data) {
    if (data === hoje()) return `Hoje, ${diaCurto(data).split(", ")[1]}`;
    if (data === amanha()) return `Amanhã, ${diaCurto(data).split(", ")[1]}`;
    return diaCurto(data);
  }

  function mascaraTelefone(v) {
    const d = v.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function idAparelho() {
    let id = guardar.ler("usab.dispositivo");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const b = crypto.getRandomValues(new Uint8Array(18));
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      guardar.gravar("usab.dispositivo", id);
    }
    return id;
  }

  // ------------------------------------------------------------------------------------------
  // API (com prazo). Falha de rede ou 5xx = sem caminho pela página → WhatsApp da barbearia.
  // ------------------------------------------------------------------------------------------

  class Falha extends Error {}

  async function chamar(opcoes) {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = opcoes.corpo
        ? await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opcoes.corpo), signal: ctl.signal })
        : await fetch(`${API}${API.includes("?") ? "&" : "?"}${new URLSearchParams(opcoes.params)}`, { signal: ctl.signal });
      if (r.status >= 500) throw new Falha(`http_${r.status}`);
      const j = await r.json().catch(() => { throw new Falha("json"); });
      return j;
    } catch (e) {
      if (e instanceof Falha) throw e;
      throw new Falha(String(e && e.name || e));
    } finally {
      clearTimeout(prazo);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Estado e navegação (o "voltar" do celular também funciona)
  // ------------------------------------------------------------------------------------------

  const S = {
    b: null, p: null, pagina: null, fallback: null,
    escolhidos: [], dias: null, diasChave: null, dia: null,
    reserva: null, pronto: null, aviso: null, proximos: null,
    turnstile: null, turnstileId: null, relogio: null, rascunho: null,
  };
  const ORDEM = ["servicos", "dias", "horarios", "confirmar", "pronto"];
  let telaAtual = null;

  function ir(tela, empilhar = true) {
    if (empilhar) history.pushState({ tela }, "");
    mostrar(tela);
  }

  window.addEventListener("popstate", (ev) => {
    // Página do link do cliente: trocar o #remarcar/#cancelar só redesenha o início.
    if (G.t) { if (G.e && !G.relogio) gInicio(); return; }
    if (!S.pagina) return;
    const tela = (ev.state && ev.state.tela) || "servicos";
    if (telaAtual === "pronto") { reiniciar(); return; }
    if (telaAtual === "confirmar" && ORDEM.indexOf(tela) < ORDEM.indexOf("confirmar")) soltarReserva();
    mostrar(tela);
  });

  function voltar() { history.back(); }

  function reiniciar() {
    S.escolhidos = []; S.dias = null; S.diasChave = null; S.dia = null; S.reserva = null; S.pronto = null;
    S.aviso = null; S.proximos = null;
    history.replaceState({ tela: "servicos" }, "");
    mostrar("servicos");
  }

  function mostrar(tela) {
    pararRelogio();
    telaAtual = tela;
    $tela.replaceChildren();
    const render = { servicos: telaServicos, dias: telaDias, horarios: telaHorarios, confirmar: telaConfirmar, pronto: telaPronto }[tela];
    const faltando = !render || (tela !== "servicos" && tela !== "pronto" && !S.escolhidos.length)
      || (tela === "horarios" && !S.dia) || (tela === "confirmar" && !S.reserva) || (tela === "pronto" && !S.pronto);
    if (faltando) { telaServicos(); telaAtual = "servicos"; }
    else render();
    const t = $tela.querySelector("h2");
    if (t) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }

  function passos(n) {
    return h("div", { class: "passos", "aria-hidden": "true" }, [1, 2, 3, 4].map((i) => h("span", { class: i <= n ? "on" : null })));
  }

  function cabecalho(titulo, n, comVoltar = true) {
    return [
      passos(n),
      h("div", { class: "cab" }, comVoltar ? h("button", { class: "voltar", type: "button", onclick: voltar }, "← Voltar") : null, h("h2", {}, titulo)),
    ];
  }

  function avisoEl() {
    if (!S.aviso) return null;
    return h("div", { class: `aviso ${S.aviso.tipo}`, role: S.aviso.tipo === "erro" ? "alert" : "status" }, S.aviso.texto);
  }

  // ------------------------------------------------------------------------------------------
  // Serviços escolhidos
  // ------------------------------------------------------------------------------------------

  function todosServicos() { return S.pagina.grupos.flatMap((g) => g.servicos); }
  function servicosEscolhidos() {
    const todos = todosServicos();
    return S.escolhidos.map((id) => todos.find((s) => s.id === id)).filter(Boolean);
  }
  function somas() {
    const l = servicosEscolhidos();
    return { min: l.reduce((t, s) => t + s.duracao_min, 0), total: l.reduce((t, s) => t + s.preco_centavos, 0), nomes: l.map((s) => s.nome) };
  }
  function linhaEscolha() {
    const s = somas();
    return `${s.nomes.join(" + ")} · ${duracao(s.min)} · ${brl(s.total)}`;
  }

  // ------------------------------------------------------------------------------------------
  // Telas
  // ------------------------------------------------------------------------------------------

  function telaServicos() {
    const barra = h("div", { class: "barra" });
    function atualizarBarra() {
      const s = somas();
      barra.replaceChildren(
        h("div", { class: "resumo", "aria-live": "polite" },
          S.escolhidos.length ? [h("strong", {}, brl(s.total)), `${S.escolhidos.length} ${S.escolhidos.length > 1 ? "serviços" : "serviço"} · ${duracao(s.min)}`] : "Escolha um ou mais serviços"),
        h("button", { class: "botao", type: "button", disabled: !S.escolhidos.length, onclick: () => { S.aviso = null; ir("dias"); } }, "Escolher o dia"),
      );
    }
    const grupos = S.pagina.grupos.map((g) =>
      h("section", { class: "grupo" },
        h("h3", {}, g.grupo),
        g.servicos.map((s) => {
          const b = h("button", {
            class: "servico", type: "button", "aria-pressed": String(S.escolhidos.includes(s.id)),
            onclick: () => {
              const i = S.escolhidos.indexOf(s.id);
              if (i >= 0) S.escolhidos.splice(i, 1);
              else if (S.escolhidos.length >= 6) return;
              else S.escolhidos.push(s.id);
              b.setAttribute("aria-pressed", String(S.escolhidos.includes(s.id)));
              b.querySelector(".check").textContent = S.escolhidos.includes(s.id) ? "✓" : "";
              S.dias = null;
              atualizarBarra();
            },
          },
          h("span", { class: "meio" },
            h("span", { class: "nome" }, s.nome),
            h("span", { class: "info" }, `${duracao(s.duracao_min)} · ${brl(s.preco_centavos)}`),
            s.descricao ? h("span", { class: "desc" }, s.descricao) : null),
          h("span", { class: "check", "aria-hidden": "true" }, S.escolhidos.includes(s.id) ? "✓" : ""));
          return b;
        })));
    atualizarBarra();
    anexar(...cabecalho("Escolha os serviços", 1, false), avisoEl(), ...grupos, barra);
  }

  async function carregarDias(forcar = false) {
    const chave = S.escolhidos.join(",");
    if (!forcar && S.dias && S.diasChave === chave) return S.dias;
    const r = await chamar({ params: { acao: "dias", b: S.b, p: S.p, s: chave } });
    if (!r.ok) throw new Error(r.mensagem || "erro");
    S.dias = r; S.diasChave = chave;
    return r;
  }

  async function telaDias() {
    anexar(...cabecalho("Escolha o dia", 2), h("p", { class: "sub" }, linhaEscolha()), avisoEl());
    const lista = h("div", {}, h("div", { class: "carregando" }, h("span", { class: "giro" }), "Buscando horários livres…"));
    anexar(lista);
    let r;
    try { r = await carregarDias(); } catch (e) { return erroCarregar(e); }
    if (telaAtual !== "dias") return;
    const comHorario = r.dias.filter((d) => d.horarios.length);
    if (!comHorario.length) {
      lista.replaceChildren(h("div", { class: "aviso info" }, "Não há horários livres nos próximos dias para esses serviços."), botaoWhats("Falar com a barbearia"));
      return;
    }
    lista.replaceChildren(...comHorario.map((d) =>
      h("button", { class: "dia", type: "button", onclick: () => { S.dia = d.data; S.aviso = null; S.proximos = null; ir("horarios"); } },
        h("span", { class: "titulo" }, rotuloDia(d.data), h("span", { class: "qtd" }, `${d.horarios.length} ${d.horarios.length > 1 ? "horários" : "horário"}`)),
        h("span", { class: "previa" }, d.horarios.slice(0, 5).map((x) => h("span", {}, x.hora)), d.horarios.length > 5 ? h("span", {}, `+${d.horarios.length - 5}`) : null))));
  }

  function telaHorarios() {
    const d = S.dias && S.dias.dias.find((x) => x.data === S.dia);
    anexar(...cabecalho(diaLongo(S.dia), 3), h("p", { class: "sub" }, linhaEscolha()), avisoEl());
    if (S.proximos && S.proximos.length) {
      anexar(h("p", { class: "periodo" }, "Próximos livres"), h("div", { class: "grade" }, S.proximos.map((x) => botaoHora(x, true))));
    }
    if (!d || !d.horarios.length) {
      anexar(h("div", { class: "aviso info" }, "Esse dia não tem mais horários livres."), h("button", { class: "botao sec largo", type: "button", onclick: voltar }, "Escolher outro dia"));
      return;
    }
    const faixas = [["Manhã", (x) => x.hora < "12:00"], ["Tarde", (x) => x.hora >= "12:00" && x.hora < "18:00"], ["Noite", (x) => x.hora >= "18:00"]];
    for (const [nome, f] of faixas) {
      const lista = d.horarios.filter(f);
      if (!lista.length) continue;
      anexar(h("p", { class: "periodo" }, nome), h("div", { class: "grade" }, lista.map((x) => botaoHora(x, false))));
    }
  }

  function botaoHora(x, comDia) {
    return h("button", {
      class: "hora", type: "button", "aria-label": `${diaLongo(x.data)}, ${x.hora}`,
      onclick: (ev) => reservar(x, ev.currentTarget),
    }, comDia && x.data !== S.dia ? `${diaCurto(x.data).split(",")[0]} ${x.hora}` : x.hora);
  }

  async function reservar(x, botao) {
    for (const b of $tela.querySelectorAll(".hora")) b.disabled = true;
    botao.classList.add("ocupando");
    botao.textContent = "…";
    let r;
    try {
      r = await chamar({ corpo: { acao: "reservar", b: S.b, p: S.p, s: S.escolhidos, inicio: x.inicio, dispositivo: idAparelho() } });
    } catch (e) { return erroCarregar(e); }
    if (r.ok && !r.conflito) {
      S.reserva = r; S.aviso = null; S.proximos = null;
      if (telaAtual === "confirmar") mostrar("confirmar"); else ir("confirmar");
      return;
    }
    if (r.ok && r.conflito) {
      S.aviso = { tipo: "erro", texto: r.mensagem };
      S.proximos = r.proximos;
      S.dia = S.dia || x.data;
      try { await carregarDias(true); } catch { /* segue com a lista antiga */ }
      if (telaAtual === "horarios") mostrar("horarios"); else ir("horarios");
      return;
    }
    S.aviso = { tipo: "erro", texto: r.mensagem || "Não consegui reservar. Tente outro horário." };
    mostrar(telaAtual);
  }

  function soltarReserva() {
    if (!S.reserva) return;
    const reserva = S.reserva.reserva;
    S.reserva = null;
    chamar({ corpo: { acao: "soltar", reserva, dispositivo: idAparelho() } }).catch(() => { /* vence sozinha em 10 min */ });
  }

  function pararRelogio() { if (S.relogio) clearInterval(S.relogio); S.relogio = null; }

  function telaConfirmar() {
    const r = S.reserva;
    const salvo = S.rascunho || guardar.ler("usab.dados") || {};
    const banner = h("div", { class: "aviso info", role: "status" });
    function tick() {
      const resta = Math.max(0, new Date(r.expira_em).getTime() - Date.now());
      if (resta <= 0) {
        banner.replaceChildren("O tempo de reserva acabou. Se o horário ainda estiver livre, a confirmação passa; se não, mostramos os próximos.");
        pararRelogio();
        return;
      }
      const m = Math.floor(resta / 60000), s = Math.floor((resta % 60000) / 1000);
      banner.replaceChildren("Horário reservado para você por ", h("span", { class: "relogio" }, `${m}:${String(s).padStart(2, "0")}`), ".");
    }
    tick();
    S.relogio = setInterval(tick, 1000);

    const l = servicosEscolhidos();
    const resumo = h("div", { class: "cartao" },
      h("p", { class: "quando" }, `${diaLongo(r.data)}`),
      h("p", { class: "mudo" }, `${r.hora_inicio} às ${r.hora_fim} · com ${S.pagina.profissional.nome}`),
      h("div", { style: "margin-top:10px" },
        l.map((s) => h("div", { class: "linha" }, h("span", {}, s.nome), h("span", { class: "val" }, brl(s.preco_centavos))))),
      h("div", { class: "linha total" }, h("span", {}, `Total · ${duracao(r.duracao_min)}`), h("span", { class: "val" }, brl(r.total_centavos))),
      enderecoTexto() ? h("p", { class: "mudo", style: "margin-top:8px" }, enderecoTexto()) : null);

    const nome = h("input", { id: "nome", type: "text", autocomplete: "name", required: true, maxlength: "80", value: salvo.nome || "" });
    const whats = h("input", { id: "whats", type: "tel", autocomplete: "tel-national", inputmode: "tel", required: true, value: salvo.whatsapp ? mascaraTelefone(salvo.whatsapp) : "", placeholder: "(13) 99999-9999" });
    whats.addEventListener("input", () => { whats.value = mascaraTelefone(whats.value); });
    const email = h("input", { id: "email", type: "email", autocomplete: "email", inputmode: "email", required: true, maxlength: "120", value: salvo.email || "" });
    const errNome = h("p", { class: "erro-campo", id: "erro-nome", "aria-live": "polite" });
    const errWhats = h("p", { class: "erro-campo", id: "erro-whats", "aria-live": "polite" });
    const errEmail = h("p", { class: "erro-campo", id: "erro-email", "aria-live": "polite" });
    nome.setAttribute("aria-describedby", "erro-nome"); whats.setAttribute("aria-describedby", "erro-whats"); email.setAttribute("aria-describedby", "erro-email sugestao-email ajuda-email");
    // D23: sugere o domínio certo (gmail.con → gmail.com); a pessoa toca para corrigir.
    const sugestao = h("p", { class: "sugestao", id: "sugestao-email", "aria-live": "polite" });
    function sugerir() {
      const s = window.usabSugerirEmail ? window.usabSugerirEmail(email.value) : null;
      if (!s) { sugestao.replaceChildren(); return; }
      sugestao.replaceChildren("Você quis dizer ",
        h("button", { type: "button", class: "link", onclick: () => { email.value = s; sugestao.replaceChildren(); errEmail.textContent = ""; } }, s), "?");
    }
    email.addEventListener("blur", sugerir);
    email.addEventListener("input", () => { if (sugestao.childNodes.length) sugerir(); });
    const lembrar = h("input", { type: "checkbox", id: "lembrar", checked: true });
    const politica = S.pagina.barbearia.politica_cancelamento
      ? h("div", { class: "cartao politica" }, h("h3", {}, "Política de cancelamento"), S.pagina.barbearia.politica_cancelamento) : null;
    const botao = h("button", { class: "botao largo", type: "submit" }, "Confirmar agendamento");
    const turn = h("div", { id: "verificacao-robo" }); // id "turnstile" viraria window.turnstile e esconderia a biblioteca

    const form = h("form", { novalidate: true, onsubmit: (ev) => { ev.preventDefault(); confirmar(); } },
      h("label", { for: "nome" }, "Seu nome"), nome, errNome,
      h("label", { for: "whats" }, "Seu WhatsApp"), whats, errWhats,
      h("label", { for: "email" }, "Seu e-mail"), email, errEmail, sugestao,
      h("p", { class: "ajuda", id: "ajuda-email" }, "Mandamos para ele a confirmação, o convite da agenda e os links para remarcar ou cancelar."),
      h("label", { class: "lembrar", for: "lembrar" }, lembrar, "Lembrar meus dados neste aparelho"),
      salvo.nome ? h("p", { class: "ajuda" }, h("a", { href: "#", onclick: (ev) => { ev.preventDefault(); guardar.apagar("usab.dados"); nome.value = ""; whats.value = ""; email.value = ""; } }, "Esquecer meus dados")) : null,
      politica, turn,
      h("p", { class: "aceite" }, "Ao confirmar, você aceita os ", h("a", { href: "/termos.html", target: "_blank" }, "Termos de uso"), " e a ", h("a", { href: "/privacidade.html", target: "_blank" }, "Política de privacidade"), "."),
      botao);

    anexar(...cabecalho("Confirme seu horário", 4), banner, avisoEl(), resumo, form);
    prepararTurnstile(turn);

    async function confirmar() {
      for (const e of [errNome, errWhats, errEmail]) e.textContent = "";
      const n = nome.value.replace(/\s+/g, " ").trim();
      const w = whats.value.replace(/\D/g, "");
      let ok = true;
      if (n.length < 2) { errNome.textContent = "Escreva seu nome."; ok = false; }
      if (w.length < 10 || w.length > 11) { errWhats.textContent = "Confira o WhatsApp com DDD."; ok = false; }
      if (!email.value.trim()) { errEmail.textContent = "Informe seu e-mail: é por ele que mandamos a confirmação."; ok = false; }
      else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) { errEmail.textContent = "Confira o e-mail."; ok = false; }
      if (!ok) { (errNome.textContent ? nome : errWhats.textContent ? whats : email).focus(); return; }
      botao.disabled = true; botao.textContent = "Confirmando…";
      const token = await esperarTurnstile();
      if (!token) {
        S.aviso = { tipo: "erro", texto: "Não conseguimos verificar a página. Recarregue e tente de novo, ou agende pelo WhatsApp." };
        botao.disabled = false; botao.textContent = "Confirmar agendamento";
        $tela.insertBefore(avisoEl(), resumo);
        return;
      }
      let r;
      try {
        r = await chamar({ corpo: { acao: "confirmar", reserva: S.reserva.reserva, dispositivo: idAparelho(), nome: n, whatsapp: w, email: email.value.trim(), turnstile: token } });
      } catch (e) { return erroCarregar(e); }
      if (r.ok && !r.conflito) {
        if (lembrar.checked) guardar.gravar("usab.dados", { nome: n, whatsapp: w, email: email.value.trim() });
        else guardar.apagar("usab.dados");
        const lista = guardar.ler("usab.agendamentos") || [];
        lista.unshift({ barbearia: S.b, profissional: S.p, inicio: r.agendamento.inicio, links: r.links, ics: icsUrl(r.token) });
        guardar.gravar("usab.agendamentos", lista.slice(0, 10));
        S.pronto = r; S.reserva = null; S.aviso = null; S.proximos = null; S.rascunho = null;
        history.replaceState({ tela: "pronto" }, "");
        mostrar("pronto");
        return;
      }
      if (r.ok && r.conflito) {
        // O horário foi tomado: volta para os horários do dia, com os próximos livres no topo.
        // Os dados digitados ficam guardados para a próxima tela de confirmação.
        S.aviso = { tipo: "erro", texto: r.mensagem }; S.proximos = r.proximos;
        S.rascunho = { nome: n, whatsapp: w, email: email.value.trim() };
        S.dia = S.reserva.data; S.reserva = null;
        try { await carregarDias(true); } catch { /* segue com a lista antiga */ }
        history.replaceState({ tela: "horarios" }, "");
        mostrar("horarios");
        return;
      }
      botao.disabled = false; botao.textContent = "Confirmar agendamento";
      resetarTurnstile();
      if (r.erro === "nome_invalido") { errNome.textContent = r.mensagem; nome.focus(); return; }
      if (r.erro === "whatsapp_invalido") { errWhats.textContent = r.mensagem; whats.focus(); return; }
      if (r.erro === "email_invalido" || r.erro === "email_obrigatorio") { errEmail.textContent = r.mensagem; email.focus(); return; }
      if (r.erro === "reserva_nao_encontrada" || r.erro === "reserva_encerrada" || r.erro === "ja_confirmado") {
        S.aviso = { tipo: "erro", texto: r.mensagem }; S.reserva = null;
        history.replaceState({ tela: "horarios" }, ""); mostrar("horarios");
        return;
      }
      S.aviso = { tipo: "erro", texto: r.mensagem || "Não consegui confirmar. Tente de novo." };
      $tela.querySelector(".aviso.erro")?.remove();
      $tela.insertBefore(avisoEl(), resumo);
    }
  }

  function icsUrl(token) { return `${API}${API.includes("?") ? "&" : "?"}acao=ics&t=${encodeURIComponent(token)}`; }

  function enderecoTexto() {
    const b = S.pagina.barbearia;
    const cidade = [b.cidade, b.uf].filter(Boolean).join("/");
    return [b.endereco, b.bairro, cidade].filter(Boolean).join(", ");
  }

  /** iPhone/iPad (inclusive iPad que se apresenta como Mac), Android ou computador. */
  function aparelho() {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/i.test(ua)) return "android";
    return "computador";
  }

  /** D24: iPhone = .ics primeiro; Android = Google primeiro; computador = os dois. */
  function botoesAgenda(google, ics) {
    const g = (cls, txt) => h("a", { class: cls, href: google, target: "_blank", rel: "noopener" }, txt);
    const i = (cls, txt) => h("a", { class: cls, href: ics }, txt);
    const tipo = aparelho();
    if (tipo === "ios") return [i("botao", "Adicionar ao calendário"), g("botao sec", "Usar o Google Agenda")];
    if (tipo === "android") return [g("botao", "Adicionar ao Google Agenda"), i("botao sec", "Outra agenda (.ics)")];
    return [g("botao", "Adicionar ao Google Agenda"), i("botao", "Outlook, Apple e outras agendas (.ics)")];
  }

  function telaPronto() {
    const r = S.pronto;
    const a = r.agendamento;
    anexar(
      h("div", { class: "concluido" }, h("div", { class: "icone", "aria-hidden": "true" }, "✓"), h("h2", {}, "Agendado!"),
        h("p", { class: "mudo" }, `Te esperamos ${diaLongo(a.data).toLowerCase()}, às ${a.hora_inicio}.`),
        h("p", { class: "mudo" }, "Você também vai receber a confirmação por e-mail.")),
      h("div", { class: "cartao" },
        h("p", { class: "quando" }, `${a.hora_inicio} às ${a.hora_fim}`),
        h("p", { class: "mudo" }, `${diaLongo(a.data)} · com ${a.profissional}`),
        h("div", { style: "margin-top:10px" }, a.servicos.map((s) => h("div", { class: "linha" }, h("span", {}, s.nome), h("span", { class: "val" }, brl(s.preco_centavos))))),
        h("div", { class: "linha total" }, h("span", {}, "Total"), h("span", { class: "val" }, brl(a.total_centavos))),
        h("p", { class: "mudo", style: "margin-top:8px" }, `${a.barbearia} · ${a.endereco}`)),
      h("div", { class: "acoes" }, botoesAgenda(r.links.google, icsUrl(r.token))),
      h("div", { class: "links" },
        h("a", { href: `${r.links.gerenciar}#remarcar` }, "Remarcar"),
        h("a", { href: `${r.links.gerenciar}#cancelar` }, "Cancelar")),
      h("p", { class: "mudo", style: "text-align:center" }, "Guarde esta página: os links de remarcar e cancelar também ficam salvos neste aparelho."),
      h("div", { class: "acoes" }, h("button", { class: "botao sec", type: "button", onclick: reiniciar }, "Agendar outro horário")));
  }

  // ------------------------------------------------------------------------------------------
  // Turnstile (proteção contra robôs no Confirmar)
  // ------------------------------------------------------------------------------------------

  const turnstilePronto = () => !!(window.turnstile && typeof window.turnstile.render === "function");
  let turnstileCarregado = null;
  function carregarTurnstile() {
    if (turnstilePronto()) return Promise.resolve();
    if (!turnstileCarregado) {
      turnstileCarregado = new Promise((ok, falhou) => {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true; s.onload = ok; s.onerror = () => { turnstileCarregado = null; falhou(new Error("turnstile")); };
        document.head.append(s);
      });
    }
    return turnstileCarregado;
  }
  function prepararTurnstile(el) {
    S.turnstile = null;
    if (!CFG.turnstileSiteKey) return;
    carregarTurnstile().then(() => {
      if (!document.body.contains(el)) return;
      S.turnstileId = window.turnstile.render(el, {
        sitekey: CFG.turnstileSiteKey, appearance: "interaction-only", language: "pt-br",
        callback: (t) => { S.turnstile = t; },
        "expired-callback": () => { S.turnstile = null; },
        "error-callback": () => { S.turnstile = null; },
      });
    }).catch(() => { S.turnstile = null; });
  }
  function resetarTurnstile() { try { if (S.turnstileId != null) window.turnstile.reset(S.turnstileId); } catch { /* ok */ } S.turnstile = null; }
  async function esperarTurnstile() {
    if (!CFG.turnstileSiteKey) return "sem-turnstile";
    for (let i = 0; i < 40 && !S.turnstile; i++) await new Promise((r) => setTimeout(r, 250));
    return S.turnstile;
  }

  // ------------------------------------------------------------------------------------------
  // Falhas: sempre um caminho (D21)
  // ------------------------------------------------------------------------------------------

  function textoWhats() {
    const nomeProf = (S.pagina && S.pagina.profissional.nome) || (S.fallback && S.fallback.profissionais && S.fallback.profissionais[S.p]) || "";
    const serv = S.pagina && S.escolhidos.length ? servicosEscolhidos().map((s) => s.nome).join(" + ") : "";
    return `Olá! Quero agendar${serv ? ` ${serv}` : " um horário"}${nomeProf ? ` com ${nomeProf}` : ""}.`;
  }
  function whatsBarbearia() { return (S.pagina && S.pagina.barbearia.whatsapp) || (S.fallback && S.fallback.whatsapp) || null; }
  function botaoWhats(texto) {
    const w = whatsBarbearia();
    if (!w) return null;
    return h("a", { class: "botao largo", style: "display:block;text-align:center;text-decoration:none;margin-top:8px", href: `https://wa.me/${w}?text=${encodeURIComponent(textoWhats())}`, target: "_blank", rel: "noopener" }, texto);
  }

  async function erroCarregar(e) {
    if (!(e instanceof Falha)) { S.aviso = { tipo: "erro", texto: (e && e.message) || "Algo deu errado." }; mostrar(telaAtual || "servicos"); return; }
    await telaSemApi();
  }

  async function telaSemApi() {
    pararRelogio();
    if (!S.fallback) {
      try { S.fallback = await (await fetch(`/b/${encodeURIComponent(S.b)}.json`, { cache: "no-store" })).json(); } catch { S.fallback = null; }
      aplicarCores((S.pagina && S.pagina.barbearia.cores) || (S.fallback && S.fallback.cores));
    }
    telaAtual = "sem_api";
    $app.removeAttribute("aria-busy");
    $tela.replaceChildren(
      h("div", { class: "cab" }, h("h2", {}, "Não consegui abrir a agenda agora")),
      h("p", { class: "sub" }, whatsBarbearia() ? "Agende pelo WhatsApp da barbearia. A mensagem já vai pronta:" : "Tente de novo em alguns minutos."),
      whatsBarbearia() ? h("div", { class: "cartao" }, h("p", { class: "mudo" }, textoWhats())) : null,
      botaoWhats("Agendar pelo WhatsApp da barbearia"),
      h("div", { class: "acoes" }, h("button", { class: "botao sec", type: "button", onclick: () => location.reload() }, "Tentar de novo")));
  }

  // ------------------------------------------------------------------------------------------
  // Aparência da barbearia
  // ------------------------------------------------------------------------------------------

  function aplicarCores(c) {
    if (!c) return;
    const ok = (v) => typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v);
    const raiz = document.documentElement.style;
    for (const k of ["fundo", "texto", "creme", "destaque"]) if (ok(c[k])) raiz.setProperty(`--${k}`, c[k]);
    if (ok(c.fundo)) document.querySelector('meta[name="theme-color"]').setAttribute("content", c.fundo);
  }
  const urlImagem = (u) => typeof u === "string" && /^(https:\/\/|\/)[^\s"'()]+$/.test(u) ? u : null;
  const iniciais = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

  function montarTopo() {
    const { barbearia: b, profissional: p } = S.pagina;
    aplicarCores(b.cores);
    document.title = `Agendar com ${p.nome} · ${b.nome}`;
    document.getElementById("barbearia-nome").textContent = b.nome;
    document.getElementById("barbearia-local").textContent = [b.bairro, b.cidade].filter(Boolean).join(" · ");
    document.getElementById("profissional-nome").textContent = p.nome;
    const logo = document.getElementById("logo");
    const lu = urlImagem(b.logo_url);
    if (lu) logo.style.backgroundImage = `url("${lu}")`; else logo.textContent = b.nome.charAt(0).toUpperCase();
    const foto = document.getElementById("foto");
    const fu = urlImagem(p.foto_url);
    if (fu) foto.style.backgroundImage = `url("${fu}")`; else foto.textContent = iniciais(p.nome);
    document.getElementById("topo").hidden = false;
  }

  // ------------------------------------------------------------------------------------------
  // Início
  // ------------------------------------------------------------------------------------------

  // ------------------------------------------------------------------------------------------
  // Link do cliente: remarcar e cancelar (etapa 4). Abrir o link só mostra; cada ação é um toque (P12).
  // ------------------------------------------------------------------------------------------

  const G = { t: null, e: null, dias: null, dia: null, relogio: null, aviso: null, proximos: null };

  function gTela(...n) {
    if (G.relogio) { clearInterval(G.relogio); G.relogio = null; }
    $tela.replaceChildren();
    anexar(...n);
    const t = $tela.querySelector("h2");
    if (t) { t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true }); }
    window.scrollTo(0, 0);
  }

  function gAviso() {
    if (!G.aviso) return null;
    const el = h("div", { class: `aviso ${G.aviso.tipo}`, role: G.aviso.tipo === "erro" ? "alert" : "status" }, G.aviso.texto);
    G.aviso = null;
    return el;
  }

  function gTopo() {
    const e = G.e;
    aplicarCores(e.barbearia.cores);
    document.title = `Seu horário · ${e.barbearia.nome}`;
    document.getElementById("barbearia-nome").textContent = e.barbearia.nome;
    document.getElementById("barbearia-local").textContent = "";
    document.getElementById("profissional-nome").textContent = e.profissional.nome;
    document.querySelector(".barbeiro p").firstChild.textContent = "Seu horário com ";
    document.getElementById("logo").textContent = e.barbearia.nome.charAt(0).toUpperCase();
    document.getElementById("foto").textContent = iniciais(e.profissional.nome);
    document.getElementById("topo").hidden = false;
  }

  function gCartao(a, titulo) {
    return h("div", { class: "cartao" },
      titulo ? h("p", { class: "mudo", style: "margin-bottom:4px" }, titulo) : null,
      h("p", { class: "quando" }, diaLongo(a.data)),
      h("p", { class: "mudo" }, `${a.hora_inicio} às ${a.hora_fim} · com ${a.profissional}`),
      h("div", { style: "margin-top:10px" }, a.servicos.map((s) => h("div", { class: "linha" }, h("span", {}, s.nome), h("span", { class: "val" }, brl(s.preco_centavos))))),
      h("div", { class: "linha total" }, h("span", {}, "Total"), h("span", { class: "val" }, brl(a.total_centavos))),
      h("p", { class: "mudo", style: "margin-top:8px" }, a.endereco));
  }

  const gAgendarDeNovo = () => h("a", { class: "botao sec largo", style: "display:block;text-align:center;text-decoration:none", href: `/${G.e.barbearia.slug}/${G.e.profissional.slug}` }, "Agendar outro horário");

  function gContagem(expira, aoAcabar) {
    const el = h("span", { class: "relogio" });
    const tick = () => {
      const resta = Math.max(0, new Date(expira).getTime() - Date.now());
      el.textContent = `${Math.floor(resta / 60000)}:${String(Math.floor((resta % 60000) / 1000)).padStart(2, "0")}`;
      if (resta <= 0) { clearInterval(G.relogio); G.relogio = null; aoAcabar(); }
    };
    // O relógio começa depois que a tela nova é montada (gTela limpa o anterior).
    setTimeout(() => { tick(); G.relogio = setInterval(tick, 1000); }, 0);
    return el;
  }

  async function gChamar(corpo) {
    try { return await chamar({ corpo: { ...corpo, t: G.t } }); } catch (e) { gSemApi(); return null; }
  }

  async function gRecarregar() {
    let r;
    try { r = await chamar({ params: { acao: "gerenciar", t: G.t } }); } catch { return gSemApi(); }
    if (!r.ok) return gInvalido(r.mensagem);
    G.e = r;
    gTopo();
    gInicio();
  }

  /** Resposta de uma ação: ok → segue; prazo acabou → recarrega com o aviso; outro erro → mostra. */
  function gTratar(r, seguir) {
    if (!r) return;
    if (r.ok) { G.e = r; return seguir(); }
    if (["remarcacao_expirada", "ja_cancelado", "encerrado", "passou", "motivo_expirado"].includes(r.erro)) {
      G.aviso = { tipo: "info", texto: r.mensagem };
      return gRecarregar();
    }
    G.aviso = { tipo: "erro", texto: r.mensagem || "Não consegui agora. Tente de novo." };
    seguir();
  }

  function gSemApi() {
    const w = G.e && G.e.barbearia.whatsapp;
    $app.removeAttribute("aria-busy");
    gTela(h("div", { class: "cab" }, h("h2", {}, "Não consegui abrir seu horário agora")),
      h("p", { class: "sub" }, w ? "Fale com a barbearia pelo WhatsApp ou tente de novo em alguns minutos." : "Tente de novo em alguns minutos."),
      w ? h("a", { class: "botao largo", style: "display:block;text-align:center;text-decoration:none", href: `https://wa.me/${w}?text=${encodeURIComponent("Olá! Preciso mudar meu horário.")}`, target: "_blank", rel: "noopener" }, "Falar com a barbearia") : null,
      h("div", { class: "acoes" }, h("button", { class: "botao sec", type: "button", onclick: () => location.reload() }, "Tentar de novo")));
  }

  function gInvalido(msg) {
    $app.removeAttribute("aria-busy");
    gTela(h("div", { class: "cab" }, h("h2", {}, "Link inválido")), h("p", { class: "sub" }, msg || "Confira o link do e-mail de confirmação."));
  }

  function gInicio() {
    const e = G.e, a = e.agendamento;
    if (e.remarcacao) return gRemarcar();
    if (a.status === "cancelado") return gCancelado();
    if (a.status !== "confirmado" || !a.futuro) {
      return gTela(h("div", { class: "cab" }, h("h2", {}, a.status === "confirmado" ? "Este horário já passou" : "Este horário já foi atendido")),
        gAviso(), gCartao(a), gAgendarDeNovo());
    }
    const querCancelar = location.hash === "#cancelar";
    const bRem = h("button", { class: querCancelar ? "botao sec largo" : "botao largo", type: "button", onclick: gIniciarRemarcacao }, "Remarcar");
    const bCan = h("button", { class: querCancelar ? "botao largo" : "botao sec largo", type: "button", onclick: gPerguntarCancelar }, "Cancelar horário");
    gTela(h("div", { class: "cab" }, h("h2", {}, "Seu horário")), gAviso(), gCartao(a),
      h("div", { class: "acoes" }, ...(querCancelar ? [bCan, bRem] : [bRem, bCan])),
      h("p", { class: "periodo" }, "Adicionar à agenda"),
      h("div", { class: "acoes" }, botoesAgenda(e.links.google, e.links.ics)),
      e.barbearia.politica_cancelamento ? h("div", { class: "cartao politica" }, h("h3", {}, "Política de cancelamento"), e.barbearia.politica_cancelamento) : null);
  }

  // Remarcação (C) -------------------------------------------------------------------------------

  async function gIniciarRemarcacao() {
    gTratar(await gChamar({ acao: "remarcar_iniciar" }), () => { G.dias = null; G.dia = null; gRemarcar(); });
  }

  async function gManter() {
    gTratar(await gChamar({ acao: "remarcar_manter" }), () => { G.aviso = { tipo: "info", texto: "Pronto: seu horário foi mantido." }; gInicio(); });
  }

  function gBannerRemarcacao() {
    const a = G.e.agendamento;
    return h("div", { class: "aviso info", role: "status" },
      `Seu horário de ${diaCurto(a.data)} às ${a.hora_inicio} continua reservado enquanto você escolhe. Tempo: `,
      gContagem(G.e.remarcacao.expira_em, () => { G.aviso = { tipo: "info", texto: "O tempo para remarcar acabou e seu horário original foi mantido." }; gRecarregar(); }),
      h("div", { style: "margin-top:10px" }, h("button", { class: "botao sec", type: "button", onclick: gManter }, "Manter meu horário")));
  }

  async function gRemarcar() {
    if (G.e.remarcacao && G.e.remarcacao.novo) return gConfirmarTroca();
    const lista = h("div", {}, h("div", { class: "carregando" }, h("span", { class: "giro" }), "Buscando horários livres…"));
    gTela(h("div", { class: "cab" }, h("h2", {}, "Escolha o novo horário")), gAviso(), gBannerRemarcacao(), lista);
    if (!G.dias) {
      try { G.dias = await chamar({ params: { acao: "remarcar_dias", t: G.t } }); } catch { return gSemApi(); }
    }
    const dias = (G.dias.dias || []).filter((d) => d.horarios.length);
    if (!dias.length) { lista.replaceChildren(h("div", { class: "aviso info" }, "Não há outros horários livres nos próximos dias.")); return; }
    lista.replaceChildren(...dias.map((d) =>
      h("button", { class: "dia", type: "button", onclick: () => { G.dia = d.data; gRemarcarHorarios(); } },
        h("span", { class: "titulo" }, rotuloDia(d.data), h("span", { class: "qtd" }, `${d.horarios.length} ${d.horarios.length > 1 ? "horários" : "horário"}`)),
        h("span", { class: "previa" }, d.horarios.slice(0, 5).map((x) => h("span", {}, x.hora)), d.horarios.length > 5 ? h("span", {}, `+${d.horarios.length - 5}`) : null))));
  }

  function gBotaoHora(x, comDia) {
    return h("button", { class: "hora", type: "button", "aria-label": `${diaLongo(x.data)}, ${x.hora}`, onclick: (ev) => gReservar(x, ev.currentTarget) },
      comDia && x.data !== G.dia ? `${diaCurto(x.data).split(",")[0]} ${x.hora}` : x.hora);
  }

  function gRemarcarHorarios() {
    const d = G.dias.dias.find((x) => x.data === G.dia);
    const blocos = [];
    if (G.proximos && G.proximos.length) blocos.push(h("p", { class: "periodo" }, "Próximos livres"), h("div", { class: "grade" }, G.proximos.map((x) => gBotaoHora(x, true))));
    G.proximos = null;
    for (const [nome, f] of [["Manhã", (x) => x.hora < "12:00"], ["Tarde", (x) => x.hora >= "12:00" && x.hora < "18:00"], ["Noite", (x) => x.hora >= "18:00"]]) {
      const l = (d ? d.horarios : []).filter(f);
      if (l.length) blocos.push(h("p", { class: "periodo" }, nome), h("div", { class: "grade" }, l.map((x) => gBotaoHora(x, false))));
    }
    gTela(passos(3), h("div", { class: "cab" }, h("button", { class: "voltar", type: "button", onclick: gRemarcar }, "← Voltar"), h("h2", {}, diaLongo(G.dia))),
      gAviso(), gBannerRemarcacao(), ...blocos);
  }

  async function gReservar(x, botao) {
    for (const b of $tela.querySelectorAll(".hora")) b.disabled = true;
    botao.textContent = "…";
    const r = await gChamar({ acao: "remarcar_reservar", inicio: x.inicio });
    if (!r) return;
    if (r.ok && r.conflito) {
      G.aviso = { tipo: "erro", texto: r.mensagem }; G.proximos = r.proximos; G.dia = x.data;
      try { G.dias = await chamar({ params: { acao: "remarcar_dias", t: G.t } }); } catch { /* segue */ }
      return gRemarcarHorarios();
    }
    gTratar(r, gConfirmarTroca);
  }

  function gConfirmarTroca() {
    const a = G.e.agendamento, n = G.e.remarcacao && G.e.remarcacao.novo;
    if (!n) return gRemarcar();
    gTela(h("div", { class: "cab" }, h("h2", {}, "Confirme a troca")), gAviso(), gBannerRemarcacao(),
      h("div", { class: "cartao" },
        h("p", { class: "mudo" }, "De"), h("p", { class: "quando", style: "text-decoration:line-through;opacity:.7" }, `${diaCurto(a.data)} · ${a.hora_inicio} às ${a.hora_fim}`),
        h("p", { class: "mudo", style: "margin-top:10px" }, "Para"), h("p", { class: "quando" }, `${diaLongo(n.data)} · ${n.hora_inicio} às ${n.hora_fim}`),
        h("p", { class: "mudo", style: "margin-top:8px" }, `${a.servicos.map((s) => s.nome).join(" + ")} · com ${a.profissional}`)),
      h("div", { class: "acoes" },
        h("button", { class: "botao largo", type: "button", onclick: async (ev) => { ev.currentTarget.disabled = true; gTratar(await gChamar({ acao: "remarcar_concluir" }), gRemarcado); } }, "Confirmar troca"),
        h("button", { class: "botao sec largo", type: "button", onclick: () => { G.e.remarcacao.novo = null; gRemarcar(); } }, "Escolher outro horário")));
  }

  function gRemarcado() {
    const e = G.e, a = e.agendamento;
    gTela(h("div", { class: "concluido" }, h("div", { class: "icone", "aria-hidden": "true" }, "✓"), h("h2", {}, "Remarcado!"),
        h("p", { class: "mudo" }, `Te esperamos ${diaLongo(a.data).toLowerCase()}, às ${a.hora_inicio}.`),
        h("p", { class: "mudo" }, "Você também vai receber a confirmação por e-mail.")),
      gCartao(a), h("div", { class: "acoes" }, botoesAgenda(e.links.google, e.links.ics)));
  }

  // Cancelamento (D) -----------------------------------------------------------------------------

  function gPerguntarCancelar() {
    const e = G.e, a = e.agendamento;
    gTela(h("div", { class: "cab" }, h("button", { class: "voltar", type: "button", onclick: gInicio }, "← Voltar"), h("h2", {}, "Cancelar o horário?")),
      gCartao(a),
      e.barbearia.politica_cancelamento ? h("div", { class: "cartao politica" }, h("h3", {}, "Política de cancelamento"), e.barbearia.politica_cancelamento) : null,
      h("div", { class: "acoes" },
        h("button", { class: "botao largo perigo", type: "button", onclick: async (ev) => { ev.currentTarget.disabled = true; gTratar(await gChamar({ acao: "cancelar" }), gCancelado); } }, "Sim, cancelar"),
        h("button", { class: "botao sec largo", type: "button", onclick: gIniciarRemarcacao }, "Prefiro remarcar")));
  }

  function gCancelado() {
    const e = G.e;
    if (!e.motivo) {
      return gTela(h("div", { class: "cab" }, h("h2", {}, "Horário cancelado")), gAviso(),
        h("p", { class: "sub" }, e.agendamento.motivo_cancelamento ? "Obrigado por contar o motivo." : "O horário já foi liberado."), gCartao(e.agendamento, "Cancelado"), gAgendarDeNovo());
    }
    const texto = h("textarea", { id: "motivo", rows: "3", maxlength: "500", placeholder: "Ex.: surgiu um compromisso" });
    gTela(h("div", { class: "cab" }, h("h2", {}, "Horário cancelado")), gAviso(),
      h("p", { class: "sub" }, "O horário já foi liberado e o profissional foi avisado."),
      h("label", { for: "motivo" }, "Quer contar o motivo? ", h("span", { class: "opc" }, "(opcional)")), texto,
      h("p", { class: "ajuda" }, "Ajuda a barbearia a melhorar. Tempo para responder: ", gContagem(e.motivo.expira_em, gRecarregar)),
      h("div", { class: "acoes" },
        h("button", { class: "botao largo", type: "button", onclick: async () => gTratar(await gChamar({ acao: "motivo", motivo: texto.value }), gCancelado) }, "Enviar"),
        h("button", { class: "botao sec largo", type: "button", onclick: async () => gTratar(await gChamar({ acao: "motivo", motivo: "" }), gCancelado) }, "Pular")),
      gAgendarDeNovo());
  }

  async function telaGerenciar(token) {
    G.t = token;
    if (!/^[0-9a-f]{32}[A-Za-z0-9_-]{43}$/.test(token || "")) return gInvalido();
    let r;
    try { r = await chamar({ params: { acao: "gerenciar", t: token } }); } catch { return gSemApi(); }
    $app.removeAttribute("aria-busy");
    if (!r.ok) return gInvalido(r.mensagem);
    G.e = r;
    gTopo();
    gInicio();
  }

  async function iniciar() {
    const partes = location.pathname.split("/").filter(Boolean);
    const q = new URLSearchParams(location.search);
    if (partes[0] === "a") return telaGerenciar(partes[1]);
    S.b = (q.get("b") || partes[0] || "").toLowerCase();
    S.p = (q.get("p") || partes[1] || "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(S.b) || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(S.p)) {
      $app.removeAttribute("aria-busy");
      $tela.replaceChildren(h("div", { class: "cab" }, h("h2", {}, "Agenda não encontrada")), h("p", { class: "sub" }, "Confira o link que você recebeu da barbearia."));
      return;
    }
    let r;
    try { r = await chamar({ params: { acao: "pagina", b: S.b, p: S.p } }); } catch { return telaSemApi(); }
    $app.removeAttribute("aria-busy");
    if (!r.ok) {
      $tela.replaceChildren(h("div", { class: "cab" }, h("h2", {}, "Agenda não encontrada")), h("p", { class: "sub" }, r.mensagem || "Confira o link que você recebeu da barbearia."));
      return;
    }
    S.pagina = r;
    montarTopo();
    history.replaceState({ tela: "servicos" }, "");
    mostrar("servicos");
  }

  iniciar();
})();

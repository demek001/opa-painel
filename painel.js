// USA.b — painel do dono (etapa 9). Entra pelo link do WhatsApp (#token), que vira uma sessão de 12 h guardada
// neste aparelho. Tudo o que vem do banco entra na tela como texto (nunca como HTML).
(() => {
  "use strict";
  const CFG = window.USAB_CONFIG || {};
  const API = new URL(CFG.apiPainel || "/api/painel", location.href).toString();
  const CHAVE = "usab_painel_sessao";
  const S = { sessao: null, periodo: "mes", prof: "", aba: "resumo", dados: null, carregando: false, fechamento: null, gerado: null, metaTipo: null };
  const $ = (s) => document.querySelector(s);
  const tela = $("#tela");

  // ---------------------------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------------------------
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "style") el.setAttribute("style", v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const f of filhos.flat(Infinity)) if (f != null && f !== false) el.append(f instanceof Node ? f : String(f));
    return el;
  }
  const svg = (tag, attrs) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const brl = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const brlCurto = (c) => { const r = c / 100; return r >= 1000 ? `R$ ${(r / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : `R$ ${Math.round(r)}`; };
  const pct = (v) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
  const int = (v) => Number(v || 0).toLocaleString("pt-BR");
  const FUSO = "America/Sao_Paulo";
  const dataHora = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: FUSO, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(".", "");
  const dataCurta = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const diaSemanaTxt = (d) => DIAS[new Date(`${d}T12:00:00Z`).getUTCDay()];
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const ROTULO_NIVEL = { bom: ["✓", "Bom"], atencao: ["!", "Atenção"], alto: ["▲", "Alto"], sem_dados: ["–", "Sem dados"] };

  function aviso(msg) {
    const a = $("#aviso");
    a.textContent = msg;
    a.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => { a.hidden = true; }, 4500);
  }

  async function api(opcoes) {
    const headers = { authorization: `Bearer ${S.sessao || ""}` };
    let r;
    try {
      r = opcoes.corpo
        ? await fetch(API, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(opcoes.corpo) })
        : await fetch(`${API}?${new URLSearchParams(opcoes.params)}`, { headers });
    } catch {
      throw new Error("Sem conexão. Confira a internet e tente de novo.");
    }
    if (opcoes.bruto && r.ok) return r;
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { esquecerSessao(); telaEntrar(j.mensagem); throw new Error("sessao"); }
    if (!r.ok || j.ok === false) throw new Error(j.mensagem || "Não consegui falar com o painel agora.");
    return j;
  }

  // ---------------------------------------------------------------------------------------------
  // Sessão
  // ---------------------------------------------------------------------------------------------
  function guardarSessao(s) { try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch { /* aparelho sem armazenamento: vale só nesta aba */ } }
  function lerSessao() { try { const s = JSON.parse(localStorage.getItem(CHAVE) || "null"); return s && new Date(s.expira_em) > new Date() ? s : null; } catch { return null; } }
  function esquecerSessao() { S.sessao = null; try { localStorage.removeItem(CHAVE); } catch { /* nada */ } }

  function telaEntrar(msg) {
    $("#barra").hidden = true; $("#abas").hidden = true; $("#sair").hidden = true;
    tela.replaceChildren(h("div", { class: "entrar cartao" },
      h("h2", null, "Painel da barbearia"),
      h("p", null, msg || "Para entrar, mande "), !msg && h("strong", null, "painel"), !msg && " no WhatsApp do Opa e toque no link que chegar.",
      h("p", { class: "nota" }, "O link vale 15 minutos e abre uma vez só. Depois, o painel fica liberado por 12 horas neste aparelho."),
      formDemo()));
  }

  // Conta de demonstração (D66): e-mail e senha, só para a Barbearia Exemplo.
  function formDemo() {
    const email = h("input", { type: "email", autocomplete: "username", required: true, maxlength: 254 });
    const senha = h("input", { type: "password", autocomplete: "current-password", required: true, maxlength: 200 });
    const erro = h("p", { class: "nota", role: "alert", hidden: true });
    const bt = h("button", { class: "bt principal", type: "submit" }, "Entrar");
    const form = h("form", { class: "secao", onsubmit: async (ev) => {
      ev.preventDefault();
      bt.disabled = true; erro.hidden = true;
      try {
        const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "entrar_demo", email: email.value, senha: senha.value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.sessao) { erro.textContent = j.mensagem || "Não consegui entrar agora."; erro.hidden = false; return; }
        guardarSessao({ token: j.sessao, expira_em: j.expira_em });
        senha.value = "";
        await iniciar();
      } catch {
        erro.textContent = "Sem conexão. Confira a internet e tente de novo."; erro.hidden = false;
      } finally { bt.disabled = false; }
    } },
      h("h2", null, "Conta de demonstração"),
      h("label", { class: "campo" }, "E-mail", email),
      h("label", { class: "campo" }, "Senha", senha),
      erro, bt);
    return form;
  }

  async function iniciar() {
    const token = location.hash.slice(1);
    if (token) {
      history.replaceState(null, "", location.pathname); // o link some da barra de endereço e do histórico
      try {
        const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "entrar", token }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.sessao) return telaEntrar(j.mensagem || "Não consegui abrir o painel. Peça um link novo no WhatsApp (mande painel).");
        guardarSessao({ token: j.sessao, expira_em: j.expira_em });
      } catch {
        return telaEntrar("Sem conexão. Confira a internet e abra o link de novo.");
      }
    }
    const s = lerSessao();
    if (!s) return telaEntrar();
    S.sessao = s.token;
    try { S.aba = sessionStorage.getItem("usab_painel_aba") || "resumo"; } catch { /* nada */ }
    $("#barra").hidden = false; $("#abas").hidden = false; $("#sair").hidden = false;
    await carregar();
  }

  async function carregar() {
    S.carregando = true;
    marcarFiltros();
    if (!S.dados) tela.replaceChildren(h("div", { class: "carregando" }, h("span", { class: "giro" }), " Abrindo o painel…"));
    try {
      S.dados = await api({ params: { acao: "dados", periodo: S.periodo, p: S.prof } });
      desenhar();
    } catch (e) {
      if (e.message !== "sessao") aviso(e.message);
    } finally {
      S.carregando = false;
    }
  }

  function marcarFiltros() {
    document.querySelectorAll("[data-periodo]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.periodo === S.periodo)));
    document.querySelectorAll("[data-aba]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.aba === S.aba)));
  }

  // ---------------------------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------------------------
  function desenhar() {
    const d = S.dados;
    $("#titulo").textContent = d.barbearia.nome;
    $("#subtitulo").textContent = `Painel · ${d.dono.nome}`;
    document.title = `${d.barbearia.nome} · Opa`;
    const sel = $("#profissional");
    if (sel.options.length === 1) for (const p of d.profissionais.filter((x) => x.ativo)) sel.append(h("option", { value: p.id }, p.nome));
    sel.value = S.prof;
    const pend = d.cotas.pendentes.length + d.a_confirmar.length;
    $("#selo-cotas").hidden = !pend;
    $("#selo-cotas").textContent = pend;
    marcarFiltros();
    const abas = { resumo: abaResumo, cotas: abaCotas, agenda: abaAgenda, ajustes: abaAjustes };
    tela.replaceChildren(...[(abas[S.aba] || abaResumo)(d)].flat());
  }

  function delta(atual, anterior, menorMelhor = false) {
    if (!anterior) return h("span", { class: "delta" }, "sem base anterior");
    const v = Math.round(((atual - anterior) / anterior) * 1000) / 10;
    if (v === 0) return h("span", { class: "delta" }, "igual ao anterior");
    return h("span", { class: `delta ${v > 0 ? "sobe" : "desce"}`, title: menorMelhor ? "quanto menor, melhor" : null }, `${Math.abs(v).toLocaleString("pt-BR")}% vs. anterior`);
  }

  function kpi(titulo, valor, det, extra) {
    return h("div", { class: "cartao kpi" }, h("h2", null, titulo), h("div", { class: "valor num" }, valor), det && h("div", { class: "det" }, det), extra);
  }

  /** Medidor com as faixas da especificação (escala até "max"). */
  function medidor(titulo, m, anterior, faixas, max, inverso, explica) {
    const [ico, rot] = ROTULO_NIVEL[m.nivel];
    const rotulo = inverso && m.nivel === "alto" ? "Baixo" : rot;
    const icone = inverso && m.nivel === "alto" ? "▼" : ico;
    const segs = inverso
      ? [["f-alto", faixas[1]], ["f-atencao", faixas[0] - faixas[1]], ["f-bom", max - faixas[0]]]
      : [["f-bom", faixas[0]], ["f-atencao", faixas[1] - faixas[0]], ["f-alto", max - faixas[1]]];
    const faixa = h("div", { class: "faixas", "aria-hidden": "true" }, segs.map(([c, w]) => h("span", { class: c, style: `flex:${w}` })));
    if (m.pct != null) faixa.append(h("i", { class: "marcador", style: `left:${Math.min(100, (m.pct / max) * 100)}%` }));
    const marcas = inverso ? [0, faixas[1], faixas[0], max] : [0, faixas[0], faixas[1], max];
    return h("div", { class: "cartao medidor" },
      h("h2", null, titulo),
      h("div", { class: "linha" }, h("span", { class: "valor num" }, pct(m.pct)), h("span", { class: `chip ${m.nivel}` }, h("span", { "aria-hidden": "true" }, icone), rotulo)),
      faixa,
      h("div", { class: "escala", "aria-hidden": "true" }, marcas.map((x, i) => h("span", { style: `left:${(x / max) * 100}%` }, `${x}${i === marcas.length - 1 ? "%" : ""}`))),
      h("div", { class: "det" }, `${int(m.parte)} de ${int(m.total)} ${explica} · antes: ${pct(anterior.pct)}`));
  }

  function grafico(d) {
    const dados = d.serie;
    if (!dados.length) return null;
    const porMes = d.periodo.serie === "mes";
    const total = dados.reduce((s, x) => s + x.valor, 0);
    const caixa = h("div", { class: "grafico" });
    const card = h("div", { class: "cartao secao" },
      h("h2", null, porMes ? "Faturamento por mês" : "Faturamento por dia"),
      h("div", { class: "det", style: "color:var(--apagado);font-size:13px;margin:-4px 0 8px" }, `${brl(total)} no período · ${int(d.atual.atendimentos)} atendimentos`),
      caixa,
      h("details", { class: "tabela-dados" }, h("summary", null, "Ver em tabela"),
        h("div", { class: "rolagem" }, h("table", { class: "tabela" },
          h("thead", null, h("tr", null, h("th", null, porMes ? "Mês" : "Dia"), h("th", { class: "n" }, "Atendimentos"), h("th", { class: "n" }, "Faturado"))),
          h("tbody", null, dados.filter((x) => x.valor || x.atendimentos).map((x) => h("tr", null,
            h("td", null, porMes ? `${MESES[Number(x.chave.slice(5, 7)) - 1]}/${x.chave.slice(2, 4)}` : `${diaSemanaTxt(x.chave)} ${dataCurta(x.chave)}`),
            h("td", { class: "n" }, int(x.atendimentos)), h("td", { class: "n" }, brl(x.valor)))))))));
    requestAnimationFrame(() => desenharBarras(caixa, dados, porMes));
    return card;
  }

  function desenharBarras(caixa, dados, porMes) {
    const W = Math.max(280, caixa.clientWidth), H = 190, esq = 46, base = H - 22, topo = 8;
    const max = Math.max(1, ...dados.map((x) => x.valor));
    const passo = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000].map((x) => x * 100)
      .find((p) => max / p <= 3.2) || max / 3;
    const teto = Math.ceil(max / passo) * passo;
    const y = (v) => base - ((base - topo) * v) / teto;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Faturamento ${porMes ? "por mês" : "por dia"}` });
    for (let v = 0; v <= teto + 1; v += passo) {
      s.append(svg("line", { class: "linha-grade", x1: esq, x2: W, y1: y(v), y2: y(v) }));
      const t = svg("text", { class: "eixo", x: esq - 6, y: y(v) + 4, "text-anchor": "end" });
      t.textContent = v === 0 ? "0" : brlCurto(v);
      s.append(t);
    }
    const n = dados.length, larg = (W - esq) / n, barra = Math.max(2, Math.min(28, larg - 2)); // barras finas, 2px entre elas
    const cadaRotulo = porMes ? 1 : n > 20 ? 5 : n > 10 ? 2 : 1;
    const dica = $("#dica");
    dados.forEach((x, i) => {
      const x0 = esq + i * larg + (larg - barra) / 2;
      const realce = svg("rect", { class: "realce", x: esq + i * larg, y: topo, width: larg, height: base - topo });
      const alvo = svg("rect", { class: "alvo", x: esq + i * larg, y: topo, width: larg, height: base - topo + 18 });
      const mostrar = (ev) => {
        realce.classList.add("on");
        const rotulo = porMes ? `${MESES[Number(x.chave.slice(5, 7)) - 1]}/${x.chave.slice(0, 4)}` : `${diaSemanaTxt(x.chave)} ${dataCurta(x.chave)}`;
        dica.replaceChildren(h("b", null, rotulo), `${brl(x.valor)} · ${int(x.atendimentos)} atendimentos`);
        dica.hidden = false;
        const px = (ev.touches ? ev.touches[0].clientX : ev.clientX), py = (ev.touches ? ev.touches[0].clientY : ev.clientY);
        dica.style.left = `${Math.min(window.innerWidth - dica.offsetWidth - 8, Math.max(8, px - dica.offsetWidth / 2))}px`;
        dica.style.top = `${Math.max(8, py - dica.offsetHeight - 14)}px`;
      };
      const esconder = () => { realce.classList.remove("on"); dica.hidden = true; };
      alvo.addEventListener("pointermove", mostrar);
      alvo.addEventListener("pointerdown", mostrar);
      alvo.addEventListener("pointerleave", esconder);
      s.append(realce);
      if (x.valor > 0) {
        const topoBarra = y(x.valor), r = Math.min(4, barra / 2, base - topoBarra);
        s.append(svg("path", { class: "barra-dado", d: `M${x0},${base}V${topoBarra + r}Q${x0},${topoBarra} ${x0 + r},${topoBarra}H${x0 + barra - r}Q${x0 + barra},${topoBarra} ${x0 + barra},${topoBarra + r}V${base}Z` }));
      } else {
        s.append(svg("rect", { class: "barra-dado zero", x: x0, y: base - 2, width: barra, height: 2, rx: 1 }));
      }
      if (i % cadaRotulo === 0) {
        const t = svg("text", { class: "eixo", x: esq + i * larg + larg / 2, y: H - 4, "text-anchor": "middle" });
        t.textContent = porMes ? MESES[Number(x.chave.slice(5, 7)) - 1] : x.chave.slice(8, 10);
        s.append(t);
      }
      s.append(alvo);
    });
    caixa.replaceChildren(s);
  }

  // ---------------------------------------------------------------------------------------------
  // Meta da semana e do mês (etapa 8B): o que fica com a casa, comparado à meta do dono
  // ---------------------------------------------------------------------------------------------
  const NIVEL_META = { bom: ["✓", "Meta coberta"], atencao: ["!", "Perto da meta"], alto: ["▲", "Abaixo da meta"], sem_dados: ["–", "Sem meta"] };

  function cartaoMeta(d) {
    if (!d.meta) return null;
    const tipo = S.metaTipo || (S.periodo === "mes" || S.periodo === "ano" ? "mes" : "semana");
    const m = d.meta[tipo];
    const [ico, rot] = NIVEL_META[m.nivel];
    const troca = h("div", { class: "periodos", role: "group", "aria-label": "Meta por semana ou por mês" },
      [["semana", "Semana"], ["mes", "Mês"]].map(([v, t]) => h("button", { type: "button", "aria-pressed": String(tipo === v), onclick: () => { S.metaTipo = v; desenhar(); } }, t)));
    const escala = Math.max(m.meta || 0, m.previsto, 1);
    const seg = (cls, v) => (v > 0 ? h("span", { class: cls, style: `width:${(v / escala) * 100}%` }) : null);
    const barra = h("div", { class: "meta-barra", role: "img", "aria-label": m.meta ? `Previsto ${brl(m.previsto)} de ${brl(m.meta)} da meta` : `Previsto ${brl(m.previsto)}` },
      seg("m-real", m.realizado), seg("m-conf", m.a_confirmar), seg("m-agen", m.agendado),
      m.meta ? h("i", { class: "meta-marca", style: `left:${(m.meta / escala) * 100}%` }) : null);
    const falta = !m.meta ? null
      : m.falta ? h("p", { class: "meta-falta" }, h("strong", null, `Faltam ${brl(m.falta)}`),
          m.faltam_atendimentos ? `, cerca de ${int(m.faltam_atendimentos)} ${m.faltam_atendimentos === 1 ? "atendimento" : "atendimentos"}` : "",
          m.casa_por_atendimento ? h("span", { class: "item-det" }, ` (ticket médio de ${brl(m.ticket)} nos últimos 90 dias; cada atendimento rende ${brl(m.casa_por_atendimento)} à casa)`) : null)
      : h("p", { class: "meta-falta" }, h("strong", null, "Meta coberta"), m.previsto > m.meta ? ` com ${brl(m.previsto - m.meta)} de folga, contando o que já está marcado.` : " contando o que já está marcado.");
    const caixa = h("div", { class: "grafico" });
    const temDia = m.dias.some((x) => x.realizado || x.a_confirmar || x.agendado || x.meta);
    const card = h("div", { class: "cartao meta" },
      h("div", { class: "meta-topo" }, h("h2", null, `Meta ${tipo === "mes" ? "do mês" : "da semana"} · ${tipo === "mes" ? m.rotulo : `${dataCurta(m.de)} a ${dataCurta(m.ate)}`}`), troca),
      h("div", { class: "linha" },
        h("div", null, h("span", { class: "valor num" }, brl(m.previsto)), m.meta ? h("span", { class: "meta-de num" }, ` de ${brl(m.meta)}`) : null,
          h("div", { class: "det" }, `fica com a casa (realizado + agendado)${m.pct != null ? ` · ${pct(m.pct)} da meta` : ""}`)),
        h("span", { class: `chip ${m.nivel}` }, h("span", { "aria-hidden": "true" }, ico), rot)),
      barra,
      h("div", { class: "legenda" },
        h("span", null, h("i", { class: "m-real" }), `Realizado: ${brl(m.realizado)}`),
        m.a_confirmar ? h("span", null, h("i", { class: "m-conf" }), `A confirmar: ${brl(m.a_confirmar)} (${int(m.qtd.a_confirmar)})`) : null,
        h("span", null, h("i", { class: "m-agen" }), `Agendado: ${brl(m.agendado)} (${int(m.qtd.agendados)})`),
        m.meta ? h("span", null, h("i", { class: "m-meta" }), `Meta por dia: ${brl(m.meta_dia || 0)} (${int(m.dias_abertos)} dias abertos)`) : null),
      falta,
      !m.meta ? h("div", { class: "alerta", style: "margin:10px 0 0" }, tipo === "mes" ? "Defina a meta da semana ou a do mês para comparar." : "Defina a meta mínima da semana para comparar.",
        h("button", { class: "bt", type: "button", onclick: () => trocarAba("ajustes") }, "Definir meta")) : null,
      m.meta && m.meta_origem === "pela_semanal" ? h("p", { class: "nota" }, `Meta do mês calculada pela meta da semana (${brl(d.barbearia.meta_semanal_centavos)}) × as semanas do mês. Para fixar um valor, use a aba Ajustes.`) : null,
      h("p", { class: "nota" }, `Faturado total previsto: ${brl(m.faturado.previsto)} (realizado ${brl(m.faturado.realizado)}${m.faturado.a_confirmar ? ` · a confirmar ${brl(m.faturado.a_confirmar)}` : ""} · agendado ${brl(m.faturado.agendado)}). Barbearia toda, sem o filtro de profissional.`),
      temDia ? caixa : null,
      temDia ? h("details", { class: "tabela-dados" }, h("summary", null, "Ver por dia em tabela"),
        h("div", { class: "rolagem" }, h("table", { class: "tabela" },
          h("thead", null, h("tr", null, h("th", null, "Dia"), h("th", { class: "n" }, "Realizado"), h("th", { class: "n" }, "A confirmar"), h("th", { class: "n" }, "Agendado"), h("th", { class: "n" }, "Meta do dia"))),
          h("tbody", null, m.dias.filter((x) => x.aberto || x.realizado || x.a_confirmar || x.agendado).map((x) => h("tr", null,
            h("td", null, `${diaSemanaTxt(x.data)} ${dataCurta(x.data)}`, x.data === d.hoje ? h("span", { class: "origem" }, "hoje") : null),
            h("td", { class: "n" }, brl(x.realizado)), h("td", { class: "n" }, x.a_confirmar ? brl(x.a_confirmar) : "—"),
            h("td", { class: "n" }, x.agendado ? brl(x.agendado) : "—"), h("td", { class: "n" }, x.aberto && m.meta ? brl(x.meta) : "—"))))))) : null);
    if (temDia) requestAnimationFrame(() => desenharMeta(caixa, m, d.hoje));
    return card;
  }

  /** Barras empilhadas por dia (realizado, a confirmar, agendado) e o traço da meta do dia. */
  function desenharMeta(caixa, m, hoje) {
    const dados = m.dias;
    const W = Math.max(280, caixa.clientWidth), H = 190, esq = 46, base = H - 22, topo = 8;
    const max = Math.max(1, ...dados.map((x) => Math.max(x.realizado + x.a_confirmar + x.agendado, x.meta)));
    const passo = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000].map((x) => x * 100).find((p) => max / p <= 3.2) || max / 3;
    const teto = Math.ceil(max / passo) * passo;
    const y = (v) => base - ((base - topo) * v) / teto;
    const s = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "O que fica com a casa por dia, comparado à meta do dia" });
    for (let v = 0; v <= teto + 1; v += passo) {
      s.append(svg("line", { class: "linha-grade", x1: esq, x2: W, y1: y(v), y2: y(v) }));
      const t = svg("text", { class: "eixo", x: esq - 6, y: y(v) + 4, "text-anchor": "end" });
      t.textContent = v === 0 ? "0" : brlCurto(v);
      s.append(t);
    }
    const n = dados.length, larg = (W - esq) / n, barra = Math.max(2, Math.min(34, larg - 2));
    const cadaRotulo = n > 20 ? 5 : n > 10 ? 2 : 1;
    const dica = $("#dica");
    dados.forEach((x, i) => {
      const x0 = esq + i * larg + (larg - barra) / 2;
      const realce = svg("rect", { class: "realce", x: esq + i * larg, y: topo, width: larg, height: base - topo });
      const alvo = svg("rect", { class: "alvo", x: esq + i * larg, y: topo, width: larg, height: base - topo + 18 });
      const mostrar = (ev) => {
        realce.classList.add("on");
        dica.replaceChildren(h("b", null, `${diaSemanaTxt(x.data)} ${dataCurta(x.data)}${x.data === hoje ? " (hoje)" : ""}`),
          `Realizado ${brl(x.realizado)}`, x.a_confirmar ? ` · a confirmar ${brl(x.a_confirmar)}` : "", ` · agendado ${brl(x.agendado)}`,
          h("br"), x.aberto ? (m.meta ? `Meta do dia ${brl(x.meta)}` : "Sem meta definida") : "Dia fechado");
        dica.hidden = false;
        dica.style.left = `${Math.min(window.innerWidth - dica.offsetWidth - 8, Math.max(8, ev.clientX - dica.offsetWidth / 2))}px`;
        dica.style.top = `${Math.max(8, ev.clientY - dica.offsetHeight - 14)}px`;
      };
      const esconder = () => { realce.classList.remove("on"); dica.hidden = true; };
      alvo.addEventListener("pointermove", mostrar);
      alvo.addEventListener("pointerdown", mostrar);
      alvo.addEventListener("pointerleave", esconder);
      s.append(realce);
      let acumulado = 0;
      for (const [cls, v] of [["m-real", x.realizado], ["m-conf", x.a_confirmar], ["m-agen", x.agendado]]) {
        if (v <= 0) continue;
        const y1 = y(acumulado), y0 = y(acumulado + v);
        // 2px de respiro entre os pedaços empilhados
        s.append(svg("rect", { class: `barra-meta ${cls}`, x: x0, y: y0, width: barra, height: Math.max(1, y1 - y0 - (acumulado ? 2 : 0)), rx: 2 }));
        acumulado += v;
      }
      if (!acumulado) s.append(svg("rect", { class: "barra-dado zero", x: x0, y: base - 2, width: barra, height: 2, rx: 1 }));
      if (x.meta > 0) s.append(svg("line", { class: "traco-meta", x1: esq + i * larg + 1, x2: esq + (i + 1) * larg - 1, y1: y(x.meta), y2: y(x.meta) }));
      if (i % cadaRotulo === 0) {
        const t = svg("text", { class: `eixo${x.data === hoje ? " hoje" : ""}`, x: esq + i * larg + larg / 2, y: H - 4, "text-anchor": "middle" });
        t.textContent = n <= 7 ? diaSemanaTxt(x.data) : x.data.slice(8, 10);
        s.append(t);
      }
      s.append(alvo);
    });
    caixa.replaceChildren(s);
  }

  function abaResumo(d) {
    const a = d.atual, b = d.anterior;
    const partes = [h("p", { class: "periodo-txt" }, `${d.periodo.rotulo} · comparado a ${d.periodo.rotuloAnterior}`)];
    const alertas = [];
    if (d.a_confirmar.length) alertas.push(h("div", { class: "alerta" }, `${d.a_confirmar.length} atendimento(s) a confirmar`, h("button", { class: "bt", type: "button", onclick: () => trocarAba("cotas") }, "Confirmar")));
    if (d.cotas.informadas) alertas.push(h("div", { class: "alerta" }, `${d.cotas.informadas === 1 ? "1 barbeiro avisou" : `${d.cotas.informadas} barbeiros avisaram`} que pagou a cota`, h("button", { class: "bt", type: "button", onclick: () => trocarAba("cotas") }, "Confirmar")));
    if (d.cotas.pendentes.some((x) => x.valor_a_pagar_centavos > 0)) alertas.push(h("div", { class: "alerta" }, `Cotas a receber: ${brl(d.cotas.total_pendente)}`, h("button", { class: "bt", type: "button", onclick: () => trocarAba("cotas") }, "Ver cotas")));
    if (d.avisos_nao_entregues.length) alertas.push(h("div", { class: "alerta" }, `${d.avisos_nao_entregues.length} aviso(s) não entregue(s) no WhatsApp nos últimos 30 dias`));
    partes.push(...alertas);
    partes.push(cartaoMeta(d));

    partes.push(h("div", { class: "grade quatro secao" },
      kpi("Faturamento", brl(a.faturado), null, delta(a.faturado, b.faturado)),
      kpi("Atendimentos", int(a.atendimentos), null, delta(a.atendimentos, b.atendimentos)),
      kpi("Ticket médio", a.ticket == null ? "—" : brl(a.ticket), "faturado ÷ atendimentos pagos", a.ticket != null && b.ticket != null && delta(a.ticket, b.ticket)),
      kpi("Ocupação", pct(a.ocupacao), `${int(Math.round(a.minutos_agendados / 60))} h agendadas de ${int(Math.round(a.minutos_trabalho / 60))} h`,
        h("div", { class: "trilho", role: "img", "aria-label": `Ocupação ${pct(a.ocupacao)}` }, h("span", { style: `width:${Math.min(100, a.ocupacao || 0)}%` })))));

    partes.push(h("h2", { class: "titulo-secao" }, "Medidores"));
    partes.push(h("div", { class: "grade dois-lg" },
      medidor("Cancelamento", a.cancelamento, b.cancelamento, [5, 10], 20, false, "agendados cancelaram"),
      medidor("Falta sem aviso", a.falta, b.falta, [5, 10], 20, false, "não vieram"),
      medidor("Remarcação abandonada", a.remarcacao_abandonada, b.remarcacao_abandonada, [5, 15], 30, false, "remarcações não terminadas"),
      medidor("Recuperação em 7 dias", a.recuperacao, b.recuperacao, [40, 20], 100, true, "voltaram a agendar")));

    partes.push(grafico(d));

    const meios = [["Pix", a.por_meio.pix], ["Cartão", a.por_meio.cartao], ["Dinheiro", a.por_meio.dinheiro]];
    const totalMeios = meios.reduce((s, [, v]) => s + v, 0);
    const clientes = a.novos + a.recorrentes;
    partes.push(h("div", { class: "grade dois-lg secao" },
      h("div", { class: "cartao" }, h("h2", null, "Como pagaram"),
        totalMeios ? meios.map(([n, v]) => h("div", { class: "hbarra" }, h("span", null, n),
          h("div", { class: "trilho" }, h("span", { style: `width:${(v / totalMeios) * 100}%` })),
          h("span", { class: "v num" }, `${brl(v)} · ${pct(Math.round((v / totalMeios) * 1000) / 10)}`))) : h("p", { class: "vazio" }, "Nenhum pagamento no período.")),
      h("div", { class: "cartao" }, h("h2", null, "Clientes atendidos"),
        clientes ? [
          h("div", { class: "dividida", role: "img", "aria-label": `${a.novos} novos e ${a.recorrentes} recorrentes` },
            h("span", { class: "a", style: `flex:${a.novos || 0.0001}` }), h("span", { class: "b", style: `flex:${a.recorrentes || 0.0001}` })),
          h("div", { class: "legenda" },
            h("span", null, h("i", { style: "background:var(--creme)" }), `Novos: ${int(a.novos)} (${pct(Math.round((a.novos / clientes) * 1000) / 10)})`),
            h("span", null, h("i", { style: "background:rgba(243,235,221,.38)" }), `Recorrentes: ${int(a.recorrentes)}`)),
          h("p", { class: "nota" }, "Novo = primeira vez que veio à barbearia.")] : h("p", { class: "vazio" }, "Nenhum atendimento no período."))));

    if (!S.prof && d.por_profissional.length) {
      partes.push(h("div", { class: "cartao secao" }, h("h2", null, "Por profissional"),
        h("div", { class: "rolagem" }, h("table", { class: "tabela" },
          h("thead", null, h("tr", null, h("th", null, "Profissional"), h("th", { class: "n" }, "Atend."), h("th", { class: "n" }, "Faturado"),
            h("th", { class: "n" }, "Ticket"), h("th", { class: "n" }, "Ocupação"), h("th", { class: "n" }, "Cancel."), h("th", { class: "n" }, "Cota"))),
          h("tbody", null, d.por_profissional.map((p) => h("tr", null,
            h("td", null, p.nome, p.papel === "dono" ? h("span", { class: "origem" }, "dono") : null),
            h("td", { class: "n" }, int(p.atendimentos)), h("td", { class: "n" }, brl(p.faturado)), h("td", { class: "n" }, p.ticket == null ? "—" : brl(p.ticket)),
            h("td", { class: "n" }, pct(p.ocupacao)), h("td", { class: "n" }, pct(p.cancelamento)), h("td", { class: "n" }, p.papel === "dono" ? "—" : brl(p.cotas)))))))));
    }

    partes.push(h("div", { class: "grade dois-lg secao" },
      h("div", { class: "cartao" }, h("h2", null, "Próximos 7 dias"),
        h("div", { class: "kpi" }, h("div", { class: "valor num" }, `${int(d.proximos_7_dias.agendados)} horários`),
          h("div", { class: "det" }, `Ocupação prevista: ${pct(d.proximos_7_dias.ocupacao)}`),
          h("div", { class: "trilho" }, h("span", { style: `width:${Math.min(100, d.proximos_7_dias.ocupacao || 0)}%` })))),
      h("div", { class: "cartao" }, h("h2", null, "Motivos de cancelamento"),
        d.motivos.length ? (() => { const m = Math.max(...d.motivos.map((x) => x.qtd)); return d.motivos.map((x) => h("div", { class: "hbarra", style: "grid-template-columns:minmax(0,1.4fr) 1fr auto" },
          h("span", { style: "font-size:13px" }, x.motivo), h("div", { class: "trilho" }, h("span", { style: `width:${(x.qtd / m) * 100}%` })), h("span", { class: "v num" }, int(x.qtd)))); })()
          : h("p", { class: "vazio" }, "Nenhum cancelamento no período."))));

    if (d.avisos_nao_entregues.length) {
      partes.push(h("div", { class: "cartao secao" }, h("h2", null, "Avisos não entregues no WhatsApp (30 dias)"),
        h("ul", { class: "lista" }, d.avisos_nao_entregues.map((v) => h("li", null,
          h("div", { class: "item-topo" }, h("span", null, `${v.tipo.replace(/_/g, " ")} → ${v.para}`), h("span", { class: "item-det" }, dataHora(v.criado_em))),
          h("div", { class: "item-det" }, String(v.ultimo_erro || "").startsWith("fora_da_janela") ? "Fora da janela de 24 h, sem modelo da Meta aprovado (foi por e-mail)." : v.ultimo_erro))))));
    }

    partes.push(h("div", { class: "acoes secao" }, h("button", { class: "bt", type: "button", onclick: exportar }, "⬇ Baixar planilha do período (CSV)")));
    return partes;
  }

  async function exportar() {
    try {
      const r = await api({ params: { acao: "exportar", periodo: S.periodo, p: S.prof }, bruto: true });
      const url = URL.createObjectURL(await r.blob());
      const a = h("a", { href: url, download: `atendimentos-${S.periodo}.csv` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { if (e.message !== "sessao") aviso(e.message); }
  }

  async function acao(corpo, ok) {
    try {
      const r = await api({ corpo });
      if (ok) aviso(ok);
      await carregar();
      return r;
    } catch (e) {
      if (e.message !== "sessao") aviso(e.message);
      return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Cotas e fechamento (etapa 8)
  // ---------------------------------------------------------------------------------------------
  const periodoTxt = (f) => (f.periodo_inicio === f.periodo_fim ? dataCurta(f.periodo_inicio) : `${dataCurta(f.periodo_inicio)} a ${dataCurta(f.periodo_fim)}`);
  const diaTxt = (d) => `${diaSemanaTxt(d)} ${dataCurta(d)}`;
  const TIPO_PIX = { email: "e-mail", celular: "celular", cpf: "CPF", cnpj: "CNPJ", aleatoria: "aleatória" };
  const MEIO = { pix: "Pix", cartao: "Cartão", dinheiro: "Dinheiro" };

  /** O dono confirma que recebeu (ou, quando a barbearia recebe, que pagou a parte do barbeiro). */
  async function confirmarPagamento(f) {
    const paga = f.direcao === "barbearia_paga";
    const pergunta = paga
      ? `Marcar que você pagou ${brl(f.valor_a_pagar_centavos)} a ${f.profissional} (fechamento de ${periodoTxt(f)})?`
      : `Confirmar que você recebeu ${brl(f.valor_a_pagar_centavos)} de ${f.profissional} (fechamento de ${periodoTxt(f)})?`;
    if (!confirm(pergunta)) return;
    const r = await acao({ acao: "marcar_pago", fechamento_id: f.id }, paga ? "Pagamento registrado." : "Recebimento confirmado.");
    if (r && S.fechamento) await abrirFechamento(f.id);
  }

  /** A tela do fechamento: extrato completo, atendimentos e o caminho do pagamento. */
  async function abrirFechamento(id) {
    try {
      const det = await api({ params: { acao: "fechamento", id } });
      S.fechamento = { id, det };
      desenhar();
      window.scrollTo({ top: 0 });
    } catch (e) { if (e.message !== "sessao") aviso(e.message); }
  }

  function situacaoChip(f) {
    if (f.situacao === "pago") return h("span", { class: "chip bom" }, h("span", { "aria-hidden": "true" }, "✓"), f.direcao === "barbearia_paga" ? "Pago" : "Recebido");
    if (f.situacao === "sem_valor") return h("span", { class: "chip sem_dados" }, h("span", { "aria-hidden": "true" }, "–"), "Sem valor a pagar");
    if (f.informado_pago_em) return h("span", { class: "chip atencao" }, h("span", { "aria-hidden": "true" }, "!"), "Pagamento informado");
    return h("span", { class: "chip aberto" }, h("span", { "aria-hidden": "true" }, "○"), "Em aberto");
  }

  function telaFechamento() {
    const { fechamento: f, atendimentos, envio, texto } = S.fechamento.det;
    const paga = f.direcao === "barbearia_paga", semValor = f.direcao === "nada" || f.situacao === "sem_valor";
    const partes = [
      h("button", { class: "bt voltar", type: "button", onclick: () => { S.fechamento = null; desenhar(); } }, "← Cotas"),
      h("div", { class: "cabeca-fechamento" }, h("h2", { class: "titulo-secao" }, `Fechamento de ${periodoTxt(f)}`), situacaoChip(f)),
      h("p", { class: "periodo-txt" }, `${f.profissional}${f.papel === "dono" ? " (dono)" : ""} · gerado em ${dataHora(f.gerado_em)} · ${f.gerado_por === "painel" ? "pelo painel" : "automático"}`),
    ];
    if (f.situacao === "aberto" && f.informado_pago_em) {
      partes.push(h("div", { class: "alerta" }, `${f.profissional} avisou que pagou em ${dataHora(f.informado_pago_em)}. Confira se o Pix chegou.`,
        h("button", { class: "bt principal", type: "button", onclick: () => confirmarPagamento(f) }, "Confirmar recebimento")));
    }
    const rotuloValor = semValor ? "Valor a pagar" : f.situacao === "pago" ? (paga ? "Pago ao barbeiro" : "Recebido") : paga ? "A pagar ao barbeiro" : "A receber";
    partes.push(h("div", { class: "grade quatro" },
      kpi("Atendimentos", int(f.qtd_atendimentos), f.faltas ? `${int(f.faltas)} não ${f.faltas === 1 ? "veio" : "vieram"}` : null),
      kpi("Faturado", brl(f.total_centavos)),
      kpi(`Cota da barbearia${f.cota_unica != null && f.direcao !== "nada" ? ` (${pct(f.cota_unica)})` : ""}`, f.direcao === "nada" ? "—" : brl(f.cota_centavos), f.direcao === "nada" ? "o dono não paga cota" : null),
      kpi(rotuloValor, semValor ? "—" : brl(f.valor_a_pagar_centavos), paga ? "faturado menos a cota" : null)));

    const meios = [["Pix", f.total_pix_centavos], ["Cartão", f.total_cartao_centavos], ["Dinheiro", f.total_dinheiro_centavos]];
    const passo = (feito, titulo, det) => h("li", { class: feito === true ? "feito" : feito === "falha" ? "falha" : "" },
      h("span", { class: "marca-passo", "aria-hidden": "true" }, feito === true ? "✓" : feito === "falha" ? "!" : "○"),
      h("div", null, h("div", null, titulo), det ? h("div", { class: "item-det" }, det) : null));
    const envioPasso = !envio ? passo(false, "Extrato no WhatsApp", "Este fechamento não teve extrato enviado.")
      : envio.situacao === "enviado" ? passo(true, "Extrato enviado no WhatsApp", dataHora(envio.enviado_em))
      : envio.situacao === "falhou" ? passo("falha", "Extrato não entregue no WhatsApp", envio.por_email ? "Foi por e-mail ao barbeiro e a você." : "Sem e-mail cadastrado: mostre este extrato ao barbeiro.")
      : passo(false, "Extrato na fila do WhatsApp", "Sai em até 1 minuto.");
    const passos = [passo(true, "Fechamento gerado", dataHora(f.gerado_em)), envioPasso];
    if (!semValor && !paga) passos.push(passo(Boolean(f.informado_pago_em), "Barbeiro avisou “Já paguei”", f.informado_pago_em ? dataHora(f.informado_pago_em) : "Ainda não avisou."));
    if (!semValor) passos.push(passo(f.situacao === "pago", paga ? "Pagamento ao barbeiro" : "Recebimento confirmado por você",
      f.situacao === "pago" ? `${dataHora(f.pago_em)}${f.pago_por ? ` · ${f.pago_por}` : ""}` : "Pendente."));

    partes.push(h("div", { class: "grade dois-lg secao" },
      h("div", { class: "cartao" }, h("h2", null, "Como pagaram"),
        f.total_centavos ? meios.map(([n, v]) => h("div", { class: "hbarra" }, h("span", null, n),
          h("div", { class: "trilho" }, h("span", { style: `width:${(v / f.total_centavos) * 100}%` })), h("span", { class: "v num" }, brl(v))))
          : h("p", { class: "vazio" }, "Nenhum pagamento neste fechamento."),
        f.anteriores_qtd ? h("p", { class: "nota" }, `Inclui ${int(f.anteriores_qtd)} atendimento(s) de antes de ${dataCurta(f.periodo_inicio)}, confirmado(s) depois (${brl(f.anteriores_centavos)}).`) : null,
        f.qtd_a_confirmar ? h("p", { class: "nota" }, `${int(f.qtd_a_confirmar)} a confirmar (${brl(f.total_a_confirmar_centavos)}) ${f.qtd_a_confirmar === 1 ? "ficou" : "ficaram"} fora do valor.`) : null),
      h("div", { class: "cartao" }, h("h2", null, "Pagamento"),
        !semValor && f.pix_chave ? h("p", { class: "pix" }, paga ? `Pix de ${f.profissional}` : `Pix para ${f.pix_recebedor || f.dono}`, h("br"),
          h("span", { class: "item-det" }, `Chave (${TIPO_PIX[f.pix_tipo] || "Pix"}): `), h("span", { class: "num" }, f.pix_chave)) : null,
        !semValor && !f.pix_chave ? h("p", { class: "nota", style: "margin:0 0 8px" }, paga ? "O barbeiro não tem chave Pix cadastrada." : "Você ainda não cadastrou a chave Pix (aba Ajustes): o extrato pede para o barbeiro combinar com você.") : null,
        h("ul", { class: "passos" }, passos),
        f.situacao === "aberto" && f.valor_a_pagar_centavos > 0 ? h("div", { class: "acoes" },
          h("button", { class: "bt principal", type: "button", onclick: () => confirmarPagamento(f) }, paga ? "Paguei" : "Confirmar recebimento")) : null)));

    partes.push(h("div", { class: "cartao secao" }, h("h2", null, "Atendimentos deste fechamento"),
      atendimentos.length ? h("div", { class: "rolagem" }, h("table", { class: "tabela" },
        h("thead", null, h("tr", null, h("th", null, "Dia"), h("th", null, "Cliente"), h("th", null, "Serviço"), h("th", null, "Pagamento"), h("th", { class: "n" }, "Valor"), h("th", { class: "n" }, "Cota"))),
        h("tbody", null, atendimentos.map((a) => h("tr", null,
          h("td", null, `${diaTxt(a.data)}${a.hora ? ` ${a.hora}` : ""}`, a.anterior ? h("span", { class: "origem" }, "confirmado depois") : null),
          h("td", null, a.cliente), h("td", null, a.servicos),
          h("td", null, a.situacao === "a_confirmar" ? "A confirmar" : a.chegou ? (MEIO[a.meio_pagamento] || "Pago") : "Não veio"),
          h("td", { class: "n" }, a.situacao === "a_confirmar" || a.chegou ? brl(a.valor_centavos) : "—"),
          h("td", { class: "n" }, a.situacao === "a_confirmar" || !a.chegou || f.direcao === "nada" ? "—" : brl(a.cota_centavos)))))))
        : h("p", { class: "vazio" }, "Nenhum atendimento neste fechamento.")));
    partes.push(h("details", { class: "tabela-dados secao" }, h("summary", null, "Ver o extrato como o barbeiro recebeu no WhatsApp"), h("pre", { class: "extrato" }, texto.replace(/\*/g, ""))));
    return partes;
  }

  /** "Gerar fechamento agora": fecha até ontem, para um profissional ou para todos. */
  async function gerarFechamento(profId, nome) {
    const ate = diaTxt(S.dados.cotas.fecha_ate);
    if (!confirm(`Gerar agora o fechamento de ${nome}, com os atendimentos até ontem (${ate})?\nO extrato vai para o WhatsApp de cada um.`)) return;
    const r = await acao({ acao: "gerar_fechamento", profissional_id: profId || null });
    if (!r) return;
    S.gerado = r;
    aviso(r.gerados.length ? `${r.gerados.length} fechamento(s) gerado(s).` : `Nada a fechar até ontem (${ate}).`);
    desenhar();
  }

  function cartaoGerar(d) {
    const sel = h("select", { "aria-label": "Profissional" }, h("option", { value: "" }, "Todos os profissionais"), d.cotas.proximos.map((p) => h("option", { value: p.id }, p.nome)));
    const g = S.gerado;
    return h("div", { class: "cartao" },
      h("h2", null, "Fechamento automático"),
      h("ul", { class: "lista" }, d.cotas.proximos.map((p) => h("li", null,
        h("div", { class: "item-topo" }, h("span", null, p.nome, p.papel === "dono" ? h("span", { class: "origem" }, "dono · só extrato") : null), h("span", { class: "num" }, `próximo: ${diaTxt(p.proximo)}`)),
        h("div", { class: "item-det" }, `Sai ${p.cadencia}${p.fechado_ate ? ` · fechado até ${dataCurta(p.fechado_ate)}` : ""}`)))),
      h("p", { class: "nota" }, "O dia e a hora de cada um ficam na aba Ajustes."),
      h("div", { class: "gerar" }, h("label", { class: "campo" }, "Gerar agora para", sel),
        h("button", { class: "bt principal", type: "button", onclick: () => gerarFechamento(sel.value, sel.value ? sel.selectedOptions[0].textContent : "todos") }, "Gerar fechamento agora")),
      h("p", { class: "nota" }, `Fecha os atendimentos até ontem (${diaTxt(d.cotas.fecha_ate)}), sem esperar o dia do fechamento. O barbeiro recebe o extrato no WhatsApp.`),
      g ? h("div", { class: "resultado-gerar", role: "status" },
        g.gerados.map((x) => h("div", { class: "item-topo" }, h("span", null, `✓ ${x.profissional} · ${periodoTxt(x)}`),
          h("button", { class: "bt", type: "button", onclick: () => abrirFechamento(x.id) }, x.situacao === "sem_valor" ? "Ver extrato" : `${brl(x.valor_a_pagar_centavos)} · ver extrato`))),
        g.sem_nada.length ? h("div", { class: "item-det" }, `Nada a fechar até ontem: ${g.sem_nada.join(", ")}.`) : null) : null);
  }

  function abaCotas(d) {
    if (S.fechamento) return telaFechamento();
    const recebe = d.barbearia.quem_recebe === "barbearia"; // a barbearia recebe do cliente e paga a parte do barbeiro
    const partes = [h("p", { class: "periodo-txt" }, "Fechamentos de cada profissional, cotas e atendimentos que ficaram sem resposta do barbeiro.")];
    if (d.cotas.informadas) {
      partes.push(h("div", { class: "alerta" }, `${d.cotas.informadas === 1 ? "1 barbeiro avisou" : `${d.cotas.informadas} barbeiros avisaram`} que pagou. Confira se o Pix chegou e confirme o recebimento.`));
    }
    partes.push(h("div", { class: "grade" },
      kpi(recebe ? "A pagar aos barbeiros" : "A receber", brl(d.cotas.total_pendente), `${d.cotas.pendentes.filter((x) => x.valor_a_pagar_centavos > 0).length} fechamento(s) em aberto`),
      kpi(recebe ? "Pago no período" : "Recebido no período", brl(d.cotas.pagas_no_periodo), d.periodo.rotulo)));

    const pend = d.cotas.pendentes.filter((x) => x.direcao !== "nada");
    partes.push(h("h2", { class: "titulo-secao" }, "Cotas em aberto"));
    partes.push(h("div", { class: "cartao" }, pend.length ? h("ul", { class: "lista" }, pend.map((f) => h("li", null,
      h("div", { class: "item-topo" }, h("strong", null, f.profissional), h("strong", { class: "num" }, brl(f.valor_a_pagar_centavos))),
      h("div", { class: "item-det" }, `${periodoTxt(f)} · ${int(f.qtd_atendimentos)} atendimentos · ${brl(f.total_centavos)} faturados · cota de ${pct(f.cota_percentual)}`),
      f.informado_pago_em ? h("div", { class: "linha-chip" }, situacaoChip({ ...f, situacao: "aberto" }), h("span", { class: "item-det" }, `avisou “Já paguei” em ${dataHora(f.informado_pago_em)}`)) : null,
      f.qtd_a_confirmar ? h("div", { class: "item-det" }, `+ ${f.qtd_a_confirmar} a confirmar (${brl(f.total_a_confirmar_centavos)}), fora do valor até serem confirmados`) : null,
      h("div", { class: "acoes" },
        h("button", { class: "bt principal", type: "button", disabled: f.valor_a_pagar_centavos <= 0, onclick: () => confirmarPagamento(f) }, f.direcao === "barbearia_paga" ? "Paguei" : "Confirmar recebimento"),
        h("button", { class: "bt", type: "button", onclick: () => abrirFechamento(f.id) }, "Ver extrato")))))
      : h("p", { class: "vazio" }, "Nenhuma cota em aberto.")));

    partes.push(h("h2", { class: "titulo-secao" }, "A confirmar"));
    partes.push(h("div", { class: "cartao" }, d.a_confirmar.length ? [
      h("p", { class: "nota", style: "margin:0 0 6px" }, "O barbeiro não respondeu “chegou?” no WhatsApp. Confirme aqui: o valor entra no fechamento em aberto."),
      h("ul", { class: "lista" }, d.a_confirmar.map((x) => h("li", null,
        h("div", { class: "item-topo" }, h("strong", null, `${x.cliente} · ${x.servicos}`), h("span", { class: "num" }, brl(x.valor_centavos))),
        h("div", { class: "item-det" }, `${x.inicio ? dataHora(x.inicio) : ""} · ${x.profissional}`),
        h("div", { class: "acoes" },
          ...[["pix", "Pix"], ["cartao", "Cartão"], ["dinheiro", "Dinheiro"]].map(([m, n]) => h("button", { class: "bt", type: "button", onclick: () => acao({ acao: "confirmar_atendimento", atendimento_id: x.id, chegou: true, meio: m }, `Confirmado: pagou com ${n}.`) }, `Veio · ${n}`)),
          h("button", { class: "bt perigo", type: "button", onclick: () => acao({ acao: "confirmar_atendimento", atendimento_id: x.id, chegou: false }, "Registrado: não veio.") }, "Não veio")))))]
      : h("p", { class: "vazio" }, "Nada a confirmar.")));

    partes.push(h("h2", { class: "titulo-secao" }, "Fechamento"));
    partes.push(cartaoGerar(d));

    partes.push(h("h2", { class: "titulo-secao" }, "Fechamentos anteriores"));
    partes.push(h("div", { class: "cartao" }, d.cotas.anteriores.length ? h("ul", { class: "lista" }, d.cotas.anteriores.map((f) => h("li", null,
      h("div", { class: "item-topo" }, h("span", null, `${f.profissional} · ${periodoTxt(f)}`), h("span", { class: "num" }, f.situacao === "pago" ? brl(f.valor_a_pagar_centavos) : "—")),
      h("div", { class: "item-det" }, f.situacao === "pago"
        ? `${f.direcao === "barbearia_paga" ? "Paga" : "Recebida"} em ${dataHora(f.pago_em)}${f.marcado_por ? ` · confirmada por ${f.marcado_por}` : ""}`
        : `Sem valor a pagar · ${int(f.qtd_atendimentos)} atendimentos · ${brl(f.total_centavos)} faturados`),
      h("div", { class: "acoes" }, h("button", { class: "bt", type: "button", onclick: () => abrirFechamento(f.id) }, "Ver extrato")))))
      : h("p", { class: "vazio" }, "Nenhum ainda.")));
    return partes;
  }

  function abaAgenda(d) {
    const hoje = d.hoje;
    const resultado = h("div");
    const f = {
      prof: h("select", null, h("option", { value: "" }, "Barbearia toda"), d.profissionais.filter((p) => p.ativo).map((p) => h("option", { value: p.id }, p.nome))),
      data: h("input", { type: "date", min: hoje, value: hoje, required: true }),
      todo: h("input", { type: "checkbox" }),
      ini: h("input", { type: "time", value: "14:00", step: 900 }),
      fim: h("input", { type: "time", value: "16:00", step: 900 }),
      motivo: h("input", { type: "text", maxlength: 200, placeholder: "Ex.: médico, feriado, curso" }),
    };
    const horas = h("div", { class: "linha-campos" }, h("label", { class: "campo" }, "Início", f.ini), h("label", { class: "campo" }, "Fim", f.fim));
    f.todo.addEventListener("change", () => { horas.hidden = f.todo.checked; });
    const form = h("form", { class: "cartao", onsubmit: async (ev) => {
      ev.preventDefault();
      const r = await acao({ acao: "bloquear", profissional_id: f.prof.value || null, data: f.data.value, dia_todo: f.todo.checked, inicio: f.ini.value, fim: f.fim.value, motivo: f.motivo.value }, "Bloqueio gravado.");
      if (!r) return;
      const box = afetadosBox(r.afetados);
      const novo = document.querySelector("#resultado-bloqueio");
      if (novo) novo.replaceChildren(box);
    } },
      h("h2", null, "Bloquear horário"),
      h("label", { class: "campo" }, "De quem", f.prof),
      h("label", { class: "campo" }, "Dia", f.data),
      h("label", { class: "opcao" }, f.todo, "O dia todo"),
      horas,
      h("label", { class: "campo" }, "Motivo (opcional)", f.motivo),
      h("button", { class: "bt principal", type: "submit" }, "Bloquear"),
      h("p", { class: "nota" }, "Se já houver clientes marcados no período, eles aparecem aqui embaixo para você combinar. Nada é cancelado sozinho."));
    resultado.id = "resultado-bloqueio";
    const lista = h("div", { class: "cartao" }, h("h2", null, "Bloqueios marcados"), d.bloqueios.length ? h("ul", { class: "lista" }, d.bloqueios.map((b) => {
      const todo = b.ini === "00:00" && b.fim_hora === "00:00" && b.fim_data > b.data;
      const dias = todo && (Date.parse(b.fim_data) - Date.parse(b.data)) / 86400000 > 1 ? `${diaSemanaTxt(b.data)} ${dataCurta(b.data)} a ${dataCurta(new Date(Date.parse(b.fim_data) - 86400000).toISOString().slice(0, 10))}` : `${diaSemanaTxt(b.data)} ${dataCurta(b.data)}`;
      return h("li", null,
        h("div", { class: "item-topo" }, h("strong", null, `${dias} · ${todo ? "dia todo" : `${b.ini}–${b.fim_hora}`}`), h("span", null, b.profissional)),
        h("div", { class: "item-det" }, b.motivo || "Sem motivo", h("span", { class: "origem" }, b.origem === "whatsapp" ? "WhatsApp" : b.origem === "painel" ? "painel" : b.origem)),
        h("div", { class: "acoes" }, h("button", { class: "bt perigo", type: "button", onclick: () => { if (confirm("Remover este bloqueio? O horário volta para a agenda.")) acao({ acao: "desbloquear", bloqueio_id: b.id }, "Bloqueio removido."); } }, "Remover")));
    })) : h("p", { class: "vazio" }, "Nenhum bloqueio marcado."));
    return [h("p", { class: "periodo-txt" }, "Feche horários de qualquer profissional ou da barbearia toda (feriado, curso, imprevisto)."),
      h("div", { class: "grade dois-lg" }, h("div", null, form, h("div", { class: "secao" }, resultado)), lista)];
  }

  function afetadosBox(afetados) {
    if (!afetados.length) return h("div", { class: "cartao" }, h("p", { class: "vazio", style: "margin:0" }, "✓ Ninguém estava marcado nesse período."));
    return h("div", { class: "cartao" }, h("h2", null, `⚠️ ${afetados.length} cliente(s) já marcado(s) nesse período`),
      h("p", { class: "nota", style: "margin:0 0 6px" }, "Nada foi cancelado. Combine com cada um:"),
      h("ul", { class: "lista" }, afetados.map((a) => h("li", null,
        h("div", { class: "item-topo" }, h("strong", null, `${a.hora} · ${a.cliente}`), h("span", null, a.profissional)),
        h("div", { class: "item-det" }, a.servicos),
        a.telefone ? h("div", { class: "acoes" }, h("a", { class: "bt", href: `https://wa.me/${a.telefone}`, target: "_blank", rel: "noopener" }, "Chamar no WhatsApp")) : null))));
  }

  function abaAjustes(d) {
    const b = d.barbearia;
    const quem = (v, t) => h("label", { class: "opcao" }, h("input", { type: "radio", name: "quem", value: v, checked: b.quem_recebe === v }), t);
    const tipo = h("select", null, h("option", { value: "" }, "Sem chave"), [["email", "E-mail"], ["celular", "Celular"], ["cpf", "CPF"], ["cnpj", "CNPJ"], ["aleatoria", "Aleatória"]]
      .map(([v, t]) => h("option", { value: v, selected: b.pix_tipo === v }, t)));
    const chave = h("input", { type: "text", value: b.pix_chave || "", maxlength: 140 });
    const recebedor = h("input", { type: "text", value: b.pix_recebedor || "", maxlength: 80 });
    const politica = h("textarea", { maxlength: 600 }, b.politica_cancelamento || "");
    const formB = h("form", { class: "cartao", onsubmit: (ev) => {
      ev.preventDefault();
      acao({ acao: "barbearia", quem_recebe: formB.querySelector("input[name=quem]:checked")?.value, pix_tipo: tipo.value || null, pix_chave: chave.value, pix_recebedor: recebedor.value, politica_cancelamento: politica.value }, "Ajustes da barbearia salvos.");
    } },
      h("h2", null, "Barbearia"),
      h("div", { class: "campo" }, "Quem recebe o dinheiro do cliente", quem("barbeiro", "Cada barbeiro recebe e paga a cota à barbearia"), quem("barbearia", "A barbearia recebe e paga a parte do barbeiro")),
      h("div", { class: "linha-campos" }, h("label", { class: "campo" }, "Tipo da chave Pix", tipo), h("label", { class: "campo" }, "Chave Pix", chave)),
      h("label", { class: "campo" }, "Nome de quem recebe", recebedor),
      h("label", { class: "campo" }, "Política de cancelamento (aparece para o cliente ao cancelar; vazio = nenhuma)", politica),
      h("button", { class: "bt principal", type: "submit" }, "Salvar"));
    const reais = (c) => (c ? (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) : "");
    const metaSemana = h("input", { type: "text", inputmode: "decimal", value: reais(b.meta_semanal_centavos), maxlength: 14, placeholder: "Ex.: 2.000,00" });
    const metaMes = h("input", { type: "text", inputmode: "decimal", value: reais(b.meta_mensal_centavos), maxlength: 14, placeholder: "Vazio = pela meta da semana" });
    const formMeta = h("form", { class: "cartao secao", onsubmit: (ev) => {
      ev.preventDefault();
      acao({ acao: "meta", meta_semanal: metaSemana.value, meta_mensal: metaMes.value }, "Meta salva.");
    } },
      h("h2", null, "Meta mínima"),
      h("div", { class: "linha-campos" }, h("label", { class: "campo" }, "Meta da semana (R$)", metaSemana), h("label", { class: "campo" }, "Meta do mês (R$, opcional)", metaMes)),
      h("p", { class: "nota", style: "margin:0 0 12px" }, "É o que fica com a casa: a cota dos barbeiros mais 100% dos seus atendimentos. Sem a meta do mês, ela é a meta da semana × as semanas do mês. Aparece no Resumo e no resumo semanal do WhatsApp (segunda às 09:00)."),
      h("button", { class: "bt principal", type: "submit" }, "Salvar meta"));
    const DIAS_SEMANA = [[1, "Segunda"], [2, "Terça"], [3, "Quarta"], [4, "Quinta"], [5, "Sexta"], [6, "Sábado"], [7, "Domingo"]];
    const profs = d.profissionais.filter((p) => p.ativo).map((p) => {
      const cota = h("input", { type: "number", min: 0, max: 100, step: 0.5, value: p.cota_percentual, disabled: p.papel === "dono" });
      const cad = h("select", null, [["semanal", "Semanal"], ["quinzenal", "Quinzenal"], ["mensal", "Mensal"]].map(([v, t]) => h("option", { value: v, selected: p.cadencia === v }, t)));
      const diaSel = h("select", null, DIAS_SEMANA.map(([v, t]) => h("option", { value: v, selected: p.fechamento_dia === v }, t)));
      const diaMes = h("input", { type: "number", min: 1, max: 28, value: p.cadencia === "mensal" ? p.fechamento_dia : 1 });
      const hora = h("input", { type: "time", value: p.fechamento_hora, step: 900 });
      const campoDia = h("label", { class: "campo" }, "Dia do fechamento", p.cadencia === "mensal" ? diaMes : diaSel);
      cad.addEventListener("change", () => campoDia.replaceChildren("Dia do fechamento", cad.value === "mensal" ? diaMes : diaSel));
      return h("form", { class: "cartao", onsubmit: (ev) => {
        ev.preventDefault();
        acao({ acao: "profissional", profissional_id: p.id, cota_percentual: Number(cota.value), cadencia: cad.value, fechamento_dia: Number(cad.value === "mensal" ? diaMes.value : diaSel.value), fechamento_hora: hora.value }, `Ajustes de ${p.nome} salvos.`);
      } },
        h("h2", null, p.nome, p.papel === "dono" ? " (dono)" : ""),
        h("div", { class: "linha-campos" }, h("label", { class: "campo" }, p.papel === "dono" ? "Cota (o dono não paga)" : "Cota da barbearia (%)", cota), h("label", { class: "campo" }, "Fechamento", cad)),
        h("div", { class: "linha-campos" }, campoDia, h("label", { class: "campo" }, "Hora", hora)),
        h("button", { class: "bt principal", type: "submit" }, "Salvar"));
    });
    return [h("p", { class: "periodo-txt" }, "Valores usados no fechamento e no extrato de cada profissional."),
      h("div", { class: "grade dois-lg" }, h("div", null, cartaoWhatsApp(d.whatsapp || {}), formB, formMeta), h("div", { class: "grade um" }, profs))];
  }

  // ---------------------------------------------------------------------------------------------
  // WhatsApp da barbearia (D66): Embedded Signup v4 da Meta. O SDK só carrega quando o dono toca em Conectar.
  // ---------------------------------------------------------------------------------------------
  const SITUACAO_WA = { ativa: ["bom", "✓", "Conectado"], erro: ["alto", "!", "Erro na conexão"], desconectada: ["sem_dados", "–", "Desconectado"], nao_conectada: ["sem_dados", "–", "Não conectado"] };
  const SITUACAO_MODELO = { APPROVED: ["bom", "✓", "Aprovado"], PENDING: ["atencao", "…", "Em análise"], REJECTED: ["alto", "✕", "Recusado"], PAUSED: ["atencao", "!", "Pausado"], DISABLED: ["alto", "✕", "Desativado"] };
  const chip = ([cls, ic, txt]) => h("span", { class: `chip ${cls}` }, h("span", { "aria-hidden": "true" }, ic), txt);

  function cartaoWhatsApp(w) {
    const linhas = [];
    if (w.situacao === "ativa") {
      linhas.push(h("dl", { class: "dados-wa" },
        h("dt", null, "Número"), h("dd", null, w.numero || "—"),
        h("dt", null, "Nome no WhatsApp"), h("dd", null, w.nome_verificado || "—"),
        h("dt", null, "Conta (WABA)"), h("dd", { class: "num" }, w.waba_id),
        h("dt", null, "Id do número"), h("dd", { class: "num" }, w.phone_number_id),
        h("dt", null, "Modo"), h("dd", null, w.modo === "coexistence" ? "App WhatsApp Business no celular + Opa" : "Só Opa (Cloud API)"),
        h("dt", null, "Conectado em"), h("dd", null, w.conectado_em ? dataHora(w.conectado_em) : "—")));
      const modelos = w.modelos || [];
      if (modelos.length) {
        linhas.push(h("h3", { class: "sub-secao" }, "Modelos de mensagem"),
          h("ul", { class: "lista-modelos" }, modelos.map((m) => h("li", null, h("span", { class: "num" }, m.nome), " ", chip(SITUACAO_MODELO[m.situacao] || ["sem_dados", "?", m.situacao]),
            m.motivo ? h("span", { class: "item-det" }, ` ${m.motivo}`) : null))));
      }
      linhas.push(h("div", { class: "acoes" },
        modelos.length ? h("button", { class: "bt", type: "button", onclick: () => acaoWhatsApp({ acao: "whatsapp_modelos" }, "Situação dos modelos atualizada.") }, "Atualizar situação") : null,
        h("button", { class: "bt perigo", type: "button", onclick: () => { if (confirm("Desconectar o WhatsApp da barbearia? O Opa para de mandar mensagens por ele.")) acaoWhatsApp({ acao: "whatsapp_desconectar" }, "WhatsApp desconectado."); } }, "Desconectar")));
    } else {
      if (w.situacao === "erro" && w.ultimo_erro) linhas.push(h("p", { class: "nota" }, "A última tentativa não terminou. Tente de novo."));
      linhas.push(h("p", { class: "nota" }, "Conecte o WhatsApp da barbearia para o Opa mandar a confirmação do horário ao cliente e os avisos à equipe pelo número da própria barbearia."),
        h("div", { class: "acoes" },
          h("button", { class: "bt principal", type: "button", onclick: () => conectarWhatsApp("coexistence") }, w.situacao === "erro" ? "Tentar de novo" : "Conectar o WhatsApp Business que já uso"),
          h("button", { class: "bt", type: "button", onclick: () => conectarWhatsApp("cloud") }, "Conectar um número novo")));
    }
    return h("section", { class: "cartao", id: "cartao-whatsapp" }, h("div", { class: "cabeca-fechamento" }, h("h2", null, "WhatsApp da barbearia"), chip(SITUACAO_WA[w.situacao] || SITUACAO_WA.nao_conectada)), linhas);
  }

  async function acaoWhatsApp(corpo, ok) {
    try {
      await api({ corpo });
      aviso(ok);
      await carregar();
    } catch (e) { if (e.message !== "sessao") aviso(e.message); }
  }

  function carregarSdkMeta() {
    if (window.FB) return Promise.resolve(window.FB);
    return new Promise((ok, falha) => {
      window.fbAsyncInit = () => { window.FB.init({ appId: CFG.metaAppId, autoLogAppEvents: true, xfbml: false, version: CFG.metaVersao || "v23.0" }); ok(window.FB); };
      const s = document.createElement("script");
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      s.async = true; s.defer = true; s.crossOrigin = "anonymous";
      s.onerror = () => falha(new Error("Não consegui abrir a janela da Meta. Confira a internet."));
      document.head.append(s);
    });
  }

  async function conectarWhatsApp(modo) {
    if (!CFG.metaAppId || !CFG.metaConfigId) return aviso("A conexão com o WhatsApp ainda não está configurada.");
    let FB;
    try { FB = await carregarSdkMeta(); } catch (e) { return aviso(e.message); }
    const retorno = { code: null, waba_id: null, phone_number_id: null };
    let enviado = false;
    const tentarEnviar = async () => {
      if (enviado || !retorno.code || !retorno.waba_id || !retorno.phone_number_id) return;
      enviado = true;
      window.removeEventListener("message", ouvir);
      aviso("Conectando o WhatsApp…");
      await acaoWhatsApp({ acao: "whatsapp_conectar", modo, ...retorno }, "WhatsApp conectado.");
    };
    const ouvir = (ev) => {
      if (!/^https:\/\/([a-z0-9-]+\.)?facebook\.com$/.test(ev.origin)) return;
      let m; try { m = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data; } catch { return; }
      if (!m || m.type !== "WA_EMBEDDED_SIGNUP") return;
      if (String(m.event || "").startsWith("FINISH")) {
        retorno.waba_id = m.data?.waba_id || null;
        retorno.phone_number_id = m.data?.phone_number_id || null;
        tentarEnviar();
      } else if (m.event === "CANCEL") {
        window.removeEventListener("message", ouvir);
        aviso("Conexão cancelada. Quando quiser, toque em Conectar de novo.");
      } else if (m.event === "ERROR") {
        window.removeEventListener("message", ouvir);
        aviso("A Meta mostrou um erro na conexão. Tente de novo.");
      }
    };
    window.addEventListener("message", ouvir);
    FB.login((r) => {
      if (r?.authResponse?.code) { retorno.code = r.authResponse.code; tentarEnviar(); }
    }, {
      config_id: CFG.metaConfigId,
      response_type: "code",
      override_default_response_type: true,
      extras: { setup: {}, sessionInfoVersion: "3", ...(modo === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}) },
    });
  }

  function trocarAba(aba) {
    S.aba = aba;
    S.fechamento = null; // sai da tela do fechamento
    S.gerado = null;
    try { sessionStorage.setItem("usab_painel_aba", aba); } catch { /* nada */ }
    desenhar();
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------------------------------------
  // Eventos
  // ---------------------------------------------------------------------------------------------
  document.querySelectorAll("[data-periodo]").forEach((b) => b.addEventListener("click", () => { if (S.carregando) return; S.periodo = b.dataset.periodo; carregar(); }));
  document.querySelectorAll("[data-aba]").forEach((b) => b.addEventListener("click", () => trocarAba(b.dataset.aba)));
  $("#profissional").addEventListener("change", (ev) => { S.prof = ev.target.value; carregar(); });
  $("#sair").addEventListener("click", async () => { try { await api({ corpo: { acao: "sair" } }); } catch { /* nada */ } esquecerSessao(); telaEntrar("Você saiu. Para entrar de novo, mande painel no WhatsApp."); });
  let redim;
  window.addEventListener("resize", () => { clearTimeout(redim); redim = setTimeout(() => { if (S.dados && S.aba === "resumo") desenhar(); }, 200); });
  iniciar();
})();

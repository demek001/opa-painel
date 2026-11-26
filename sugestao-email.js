// USA.b — sugestão de correção do domínio do e-mail (D23): "joao@gmail.con" → "joao@gmail.com".
// Só sugere; quem decide é a pessoa. Script comum (a página) e importável nos testes (Deno).
(function (g) {
  "use strict";

  const DOMINIOS = [
    "gmail.com", "hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "msn.com",
    "yahoo.com", "yahoo.com.br", "icloud.com", "me.com", "uol.com.br", "bol.com.br", "terra.com.br",
    "ig.com.br", "globo.com", "globomail.com", "proton.me", "protonmail.com",
  ];

  // Distância de edição com troca de letras vizinhas (gmial → gmail = 1).
  function distancia(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /** E-mail corrigido, ou null quando não há o que sugerir. */
  function sugerirEmail(bruto) {
    const e = String(bruto || "").trim().toLowerCase();
    const i = e.lastIndexOf("@");
    if (i < 1 || i === e.length - 1) return null;
    const usuario = e.slice(0, i);
    const dominio = e.slice(i + 1);
    if (DOMINIOS.includes(dominio) || dominio.length < 4) return null;
    // Final digitado errado: .con, .cmo, .om, .comm… → .com; .com.b, .combr → .com.br
    const fim = dominio
      .replace(/\.(con|cmo|cpm|vom|xom|comm|om|cm|coom)$/, ".com")
      .replace(/\.com\.(b|bt|be|r|brr)$/, ".com.br")
      .replace(/\.combr$/, ".com.br");
    if (DOMINIOS.includes(fim)) return `${usuario}@${fim}`;
    let melhor = null;
    let menor = 3;
    for (const c of DOMINIOS) {
      const dist = distancia(fim, c);
      if (dist < menor) { menor = dist; melhor = c; }
    }
    if (melhor && menor <= 2) return `${usuario}@${melhor}`;
    return fim !== dominio ? `${usuario}@${fim}` : null;
  }

  g.usabSugerirEmail = sugerirEmail;
})(typeof window !== "undefined" ? window : globalThis);

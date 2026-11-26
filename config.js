// ConfiguraÃ§Ã£o da pÃ¡gina e do painel em PRODUÃ‡ÃƒO (painel.useusa.com.br). O publicar-painel.ps1 copia este arquivo
// como config.js. Nada aqui Ã© segredo: sÃ£o endereÃ§os e identificadores pÃºblicos.
// PREENCHER: o publicar-painel.ps1 recusa publicar enquanto houver algum PREENCHER neste arquivo.
window.USAB_CONFIG = {
  api: "https://xpzjwlhrlebdpcybxaxu.supabase.co/functions/v1/usab_agenda",
  apiPainel: "https://xpzjwlhrlebdpcybxaxu.supabase.co/functions/v1/usab_painel",
  // Cloudflare Turnstile: widget do domÃ­nio painel.useusa.com.br (chave do site, pÃºblica).
  turnstileSiteKey: "0x4AAAAAAGUti9CEC_nHrLgJ",
  // App da Meta do Opa: id do app e id da configuraÃ§Ã£o do Login do Facebook para empresas (Embedded Signup v4).
  metaAppId: "4233834003573813",
  metaConfigId: "1451774840406695", // modelo de 60 dias (App Review); trocar pelo "Nunca expira" depois da aprovaÃ§Ã£o
  metaVersao: "v23.0",
};

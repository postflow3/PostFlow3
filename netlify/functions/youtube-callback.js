const { getStore } = require("@netlify/blobs");
const { hasSession, verifyStateCookie, encryptJson } = require("./_lib/security");

const html = (title, message, success = false) => `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — PostFlow3</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;color:#171735"><h1>${title}</h1><p>${message}</p><p><a href="/">Voltar ao PostFlow3</a></p><script>if(${success}){try{if(window.opener)window.opener.postMessage({type:"postflow3-youtube-connected"},"*")}catch(e){}}</script></body></html>`;

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": "pf3_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/.netlify/functions; Max-Age=0" };
  if (params.error) return { statusCode: 400, headers, body: html("Autorização cancelada", "O Google não autorizou o acesso. Volte ao PostFlow3 e tente novamente.") };
  if (!params.code || !params.state) return { statusCode: 400, headers, body: html("Retorno inválido", "O Google não enviou os dados necessários. Inicie a conexão novamente.") };
  if (!hasSession(event)) return { statusCode: 401, headers, body: html("Sessão expirada", "Volte ao PostFlow3, entre novamente e repita a conexão.") };
  if (!verifyStateCookie(event, params.state)) return { statusCode: 400, headers, body: html("Validação de segurança falhou", "Não foi possível validar esta solicitação. Inicie a conexão novamente.") };

  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("As credenciais do Google não estão configuradas na Netlify.");
    const siteUrl = (process.env.URL || "https://earnest-panda-af735b.netlify.app").replace(/\/$/, "");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: params.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${siteUrl}/.netlify/functions/youtube-callback`,
        grant_type: "authorization_code"
      })
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) {
      return { statusCode: 502, headers, body: html("Não foi possível conectar", "O Google recusou a troca do código. Confira o URI de redirecionamento e as credenciais na Google Cloud.") };
    }
    const store = getStore("postflow3-private-tokens");
    await store.set("youtube-owner", encryptJson({ ...tokens, saved_at: Date.now() }));
    return { statusCode: 200, headers, body: html("YouTube conectado!", "A autorização foi concluída e os tokens foram guardados criptografados no servidor.", true) };
  } catch (error) {
    return { statusCode: 500, headers, body: html("Erro na conexão", "Confira as variáveis de ambiente e a configuração de armazenamento da Netlify. Nenhum token foi exibido nesta página.") };
  }
};
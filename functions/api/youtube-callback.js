import { getSession, verifyStateCookie, encryptJson, userKey } from "../_lib/security.js";

// Redeploy after Google OAuth secrets are configured in the Cloudflare Pages preview environment.

function page(title, message, success = false) {
  const safeTitle = title.replace(/[&<>"]/g, "");
  const safeMessage = message.replace(/[&<>"]/g, "");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — PostFlow3</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;color:#171735"><h1>${safeTitle}</h1><p>${safeMessage}</p><p><a href="/">Voltar ao PostFlow3</a></p><script>if(${success}){try{if(window.opener)window.opener.postMessage({type:"postflow3-youtube-connected"},window.location.origin)}catch(e){}}</script></body></html>`;
}
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": "pf3_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0" };
  const respond = (title, message, status = 400, success = false) => new Response(page(title, message, success), { status, headers });
  if (!env.POSTFLOW3_KV) return respond("Armazenamento não configurado", "Configure o namespace KV POSTFLOW3_KV no Cloudflare Pages.", 503);
  if (params.has("error")) return respond("Autorização cancelada", "O Google não autorizou o acesso. Volte ao PostFlow3 e tente novamente.");
  if (!params.get("code") || !params.get("state")) return respond("Retorno inválido", "O Google não enviou os dados necessários. Inicie a conexão novamente.");
  const session = await getSession(request, env);
  if (!session) return respond("Sessão expirada", "Volte ao PostFlow3, entre novamente e repita a conexão.", 401);
  if (!(await verifyStateCookie(request, env, params.get("state"), session.userId))) return respond("Validação de segurança falhou", "Não foi possível validar esta solicitação. Inicie a conexão novamente.");
  try {
    const clientId = env.GOOGLE_CLIENT_ID, clientSecret = env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return respond("Configuração incompleta", "Configure as credenciais Google nos secrets do Cloudflare Pages.", 503);
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: params.get("code"), client_id: clientId, client_secret: clientSecret, redirect_uri: env.GOOGLE_REDIRECT_URI || "https://cloudflare-migration.postflow3.pages.dev/api/youtube-callback", grant_type: "authorization_code" })
    });
    const tokens = await response.json();
    if (!response.ok || !tokens.access_token) return respond("Não foi possível conectar", "O Google recusou a troca do código. Confira o URI de redirecionamento e as credenciais na Google Cloud.", 502);
    const stored = { ...tokens, expiry_date: Date.now() + Number(tokens.expires_in || 3600) * 1000, saved_at: Date.now() };
    await env.POSTFLOW3_KV.put(userKey(session.userId,"youtube-owner"), await encryptJson(env, stored));
    return respond("Google conectado!", "A autorização do YouTube e a permissão de leitura do Google Drive foram guardadas criptografadas no servidor.", 200, true);
  } catch {
    return respond("Erro na conexão", "Confira os secrets e a configuração de armazenamento do Cloudflare Pages. Nenhum token foi exibido nesta página.", 500);
  }
}

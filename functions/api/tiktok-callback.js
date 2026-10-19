import { hasSession, verifyStateCookie, encryptJson } from "../_lib/security.js";

function page(title, message, success = false) {
  const safeTitle = String(title).replace(/[&<>"]/g, "");
  const safeMessage = String(message).replace(/[&<>"]/g, "");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — PostFlow3</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;color:#171735"><h1>${safeTitle}</h1><p>${safeMessage}</p><p><a href="/">Voltar ao PostFlow3</a></p><script>if(${success}){try{if(window.opener)window.opener.postMessage({type:"postflow3-tiktok-connected"},window.location.origin)}catch(e){}}</script></body></html>`;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), params = url.searchParams;
  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": "pf3_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0"
  };
  const respond = (title, message, status = 400, success = false) => new Response(page(title, message, success), { status, headers });
  if (!env.POSTFLOW3_KV) return respond("Armazenamento não configurado", "Configure o namespace KV POSTFLOW3_KV no Cloudflare Pages.", 503);
  if (params.has("error")) return respond("Autorização cancelada", params.get("error_description") || "O TikTok não autorizou o acesso. Confira os produtos e as permissões do app e tente novamente.");
  const code = params.get("code"), state = params.get("state");
  if (!code || !state) return respond("Retorno inválido", "O TikTok não enviou os dados necessários. Inicie a conexão novamente.");
  if (!(await hasSession(request, env))) return respond("Sessão expirada", "Volte ao PostFlow3, entre novamente e repita a conexão.", 401);
  if (!(await verifyStateCookie(request, env, state))) return respond("Validação de segurança falhou", "Não foi possível validar esta solicitação. Inicie a conexão novamente.");
  try {
    const clientKey = env.TIKTOK_CLIENT_KEY, clientSecret = env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) return respond("Configuração incompleta", "Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET nos secrets do Cloudflare Pages.", 503);
    const redirectUri = env.TIKTOK_REDIRECT_URI || new URL("/api/tiktok-callback", request.url).toString();
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token || !tokens.open_id) {
      return respond("Não foi possível conectar", tokens.error_description || "O TikTok recusou a autorização. Confira a Client Key, o Client Secret, a URI de retorno e as permissões aprovadas.", 502);
    }
    const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
    profileUrl.searchParams.set("fields", "open_id,display_name,avatar_url");
    const profileResponse = await fetch(profileUrl, { headers: { Authorization: "Bearer " + tokens.access_token } });
    const profileData = await profileResponse.json();
    const user = profileData?.data?.user;
    if (!profileResponse.ok || !user?.open_id) {
      return respond("Autorização incompleta", "A conta foi autorizada, mas o TikTok não retornou o perfil. Confira se o escopo user.info.basic está habilitado no app.", 502);
    }
    const stored = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || "",
      open_id: tokens.open_id,
      scope: tokens.scope || "",
      token_type: tokens.token_type || "Bearer",
      expiry_date: Date.now() + Number(tokens.expires_in || 86400) * 1000,
      refresh_expiry_date: Date.now() + Number(tokens.refresh_expires_in || 31536000) * 1000,
      display_name: user.display_name || "",
      avatar_url: user.avatar_url || "",
      saved_at: Date.now()
    };
    await env.POSTFLOW3_KV.put("tiktok-owner", await encryptJson(env, stored));
    return respond("TikTok conectado!", "A conta " + (user.display_name || "TikTok") + " foi autorizada. Os tokens foram guardados criptografados no servidor.", 200, true);
  } catch {
    return respond("Erro na conexão", "Confira os secrets do TikTok, o armazenamento KV e as configurações do app. Nenhum token foi exibido.", 500);
  }
}

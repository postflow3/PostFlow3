import { getSession, verifyStateCookie } from "../_lib/security.js";
import { saveSocialAccount } from "../_lib/social-accounts.js";

function page(title, message, success = false) {
  const safeTitle = String(title).replace(/[&<>"]/g, "");
  const safeMessage = String(message).replace(/[&<>]/g, "");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — PostFlow3</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;background:#020b1c;color:#edf4ff"><h1>${safeTitle}</h1><p>${safeMessage}</p><p><a style="color:#45c9ff" href="/">Voltar ao PostFlow3</a></p><script>if(${success}){try{if(window.opener)window.opener.postMessage({type:"postflow3-tiktok-connected"},window.location.origin)}catch(e){}}</script></body></html>`;
}
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), p = url.searchParams;
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const respond = (title, message, status = 400, success = false) => new Response(page(title, message, success), { status, headers });
  if (!env.POSTFLOW3_KV) return respond("Armazenamento não configurado", "Configure POSTFLOW3_KV no Cloudflare Pages Preview.", 503);
  if (p.has("error")) return respond("Autorização cancelada", "O TikTok não autorizou o acesso. Volte ao PostFlow3 e tente novamente.");
  const code = p.get("code"), state = p.get("state");
  if (!code || !state) return respond("Retorno inválido", "O TikTok não enviou os dados necessários. Inicie a conexão novamente.");
  const session = await getSession(request, env);
  if (!session) return respond("Sessão expirada", "Entre novamente no PostFlow3 e repita a conexão.", 401);
  if (!(await verifyStateCookie(request, env, state, session.userId))) return respond("Validação de segurança falhou", "Não foi possível validar esta solicitação. Inicie a conexão novamente.");
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return respond("Configuração incompleta", "Configure os secrets TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET no Preview.", 503);
  const redirectUri = env.TIKTOK_REDIRECT_URI || "https://cloudflare-migration.postflow3.pages.dev/api/tiktok-callback";
  try {
    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-store" },
      body: new URLSearchParams({
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenData.access_token || !tokenData.open_id) {
      const detail = String(tokenData.error_description || tokenData.error || "O TikTok recusou a troca do código por token.").replace(/[\r\n<>]/g, " ").slice(0, 180);
      return respond("Não foi possível conectar", detail + " Confira o Client Key, Client Secret, o domínio autorizado e a URI de retorno no TikTok for Developers.", 502);
    }
    const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
    profileUrl.searchParams.set("fields", "open_id,display_name,username,avatar_url");
    const profileResponse = await fetch(profileUrl, { headers: { Authorization: "Bearer " + tokenData.access_token } });
    const profileData = await profileResponse.json().catch(() => ({}));
    const profile = profileData.data?.user || {};
    if (!profileResponse.ok || (profile.open_id && String(profile.open_id) !== String(tokenData.open_id))) {
      return respond("Conexão incompleta", "O TikTok autorizou o acesso, mas não foi possível confirmar o perfil. Confira se a permissão user.info.basic está aprovada no aplicativo.", 502);
    }
    const accountId = String(profile.open_id || tokenData.open_id);
    const now = Date.now();
    const accountData = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || "",
      open_id: accountId,
      username: profile.username || profile.display_name || "TikTok",
      display_name: profile.display_name || "",
      avatar_url: profile.avatar_url || "",
      scope: String(tokenData.scope || ""),
      access_token_expires_at: now + Number(tokenData.expires_in || 86400) * 1000,
      refresh_token_expires_at: now + Number(tokenData.refresh_expires_in || 31536000) * 1000,
      saved_at: now
    };
    await saveSocialAccount(env, session.userId, "tiktok", accountId, accountData.username, accountData);
    return respond("TikTok conectado!", "A conta " + accountData.username + " foi autorizada e os tokens foram guardados criptografados no servidor.", 200, true);
  } catch (error) {
    console.error("PostFlow3 TikTok callback failure", { error_name: error?.name || "Error", error_message: String(error?.message || "erro desconhecido").slice(0, 180) });
    return respond("Erro na conexão", "Não foi possível concluir a autorização. Confira a configuração do TikTok for Developers e tente novamente.", 500);
  }
}

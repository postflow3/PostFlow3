import { getSession, verifyStateCookie } from "../_lib/security.js";
import { saveSocialAccount } from "../_lib/social-accounts.js";

const GRAPH_VERSION = "v23.0";
const GRAPH = "https://graph.facebook.com/" + GRAPH_VERSION;

function page(title, message, success = false) {
  const t = String(title).replace(/[&<>"]/g, "");
  const m = String(message).replace(/[&<>"]/g, "");
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t} — PostFlow3</title><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;color:#171735"><h1>${t}</h1><p>${m}</p><p><a href="/">Voltar ao PostFlow3</a></p><script>if(${success}){try{if(window.opener)window.opener.postMessage({type:"postflow3-instagram-connected"},window.location.origin)}catch(e){}}</script></body></html>`;
}

async function graphGet(path, params) {
  const url = new URL(GRAPH + "/" + String(path).replace(/^\/+/, ""));
  for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data.error?.message || "A Meta recusou a consulta de contas do Instagram.").slice(0, 220));
  return data;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), p = url.searchParams;
  const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Set-Cookie": "pf3_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=0" };
  const respond = (title, message, status = 400, ok = false) => new Response(page(title, message, ok), { status, headers });

  if (!env.POSTFLOW3_DB && !env.POSTFLOW3_KV) return respond("Armazenamento não configurado", "Configure o banco D1 POSTFLOW3_DB no Cloudflare Pages.", 503);
  if (p.has("error")) return respond("Autorização cancelada", "A Meta não autorizou o acesso. Volte ao PostFlow3 e tente novamente.");
  const code = p.get("code"), state = p.get("state");
  if (!code || !state) return respond("Retorno inválido", "A Meta não enviou os dados necessários. Inicie a conexão novamente.");

  const session = await getSession(request, env);
  if (!session) return respond("Sessão expirada", "Volte ao PostFlow3, entre novamente e repita a conexão.", 401);
  if (!(await verifyStateCookie(request, env, state, session.userId))) return respond("Validação de segurança falhou", "Não foi possível validar esta solicitação. Inicie a conexão novamente.");

  let stage = "validando a configuração";
  try {
    const appId = env.META_APP_ID || "1628313285604238";
    const appSecret = env.META_APP_SECRET || env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) return respond("Configuração incompleta", "Configure o App ID e o App Secret correspondentes no Cloudflare Pages.", 503);
    const redirectUri = env.INSTAGRAM_REDIRECT_URI || url.origin + "/api/instagram-callback";

    stage = "trocando o código de autorização";
    const tokenUrl = new URL(GRAPH + "/oauth/access_token");
    tokenUrl.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }).toString();
    const tokenResponse = await fetch(tokenUrl, { headers: { Accept: "application/json" } });
    const token = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !token.access_token) {
      const detail = String(token.error?.message || token.error_description || "A Meta não retornou um token válido.").replace(/[\r\n<>]/g, " ").slice(0, 220);
      return respond("Não foi possível conectar", "A Meta recusou a troca do código por token: " + detail, 502);
    }

    stage = "identificando as contas Instagram liberadas";
    const appToken = appId + "|" + appSecret;
    const debug = await graphGet("debug_token", { input_token: token.access_token, access_token: appToken });
    const tokenInfo = debug.data || {};
    const granted = Array.isArray(tokenInfo.granular_scopes) ? tokenInfo.granular_scopes : [];
    const ids = [...new Set(granted.filter(item => ["instagram_basic", "instagram_content_publish"].includes(item.scope)).flatMap(item => Array.isArray(item.target_ids) ? item.target_ids : []).map(String).filter(id => /^\d{5,30}$/.test(id)))];

    const accounts = [];
    for (const accountId of ids) {
      try {
        const profile = await graphGet(accountId, { fields: "id,username,followers_count,media_count", access_token: token.access_token });
        if (profile.id && profile.username) accounts.push(profile);
      } catch (error) {
        console.warn("PostFlow3 Instagram granted asset lookup failed", { accountId, message: String(error?.message || error).slice(0, 160) });
      }
    }

    // Compatibility fallback for Meta configurations that expose linked Pages instead of
    // Instagram asset IDs in granular_scopes.
    if (!accounts.length) {
      try {
        const pages = await graphGet("me/accounts", { fields: "id,name,access_token,instagram_business_account{id,username,followers_count,media_count}", limit: 100, access_token: token.access_token });
        for (const item of pages.data || []) {
          const ig = item.instagram_business_account;
          if (ig?.id && ig?.username) accounts.push({ ...ig, page_access_token: item.access_token || "" });
        }
      } catch {}
    }

    if (!accounts.length) {
      return respond("Conta Instagram não encontrada", "A Meta autorizou o aplicativo, mas não retornou uma conta Instagram profissional vinculada à configuração. Confira se a configuração inclui Instagram account e as permissões instagram_basic e instagram_content_publish, e tente novamente.", 422);
    }

    stage = "salvando a conexão com segurança";
    const expiresIn = Number(token.expires_in || 0);
    const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0;
    for (const profile of accounts) {
      const accessToken = profile.page_access_token || token.access_token;
      const accountData = {
        access_token: accessToken,
        expiry_date: expiresAt || null,
        user_id: String(profile.id),
        username: String(profile.username || ""),
        followers_count: Number(profile.followers_count || 0),
        media_count: Number(profile.media_count || 0),
        api_base: GRAPH,
        token_type: "business_integration_system_user",
        saved_at: Date.now()
      };
      await saveSocialAccount(env, session.userId, "instagram", String(profile.id), profile.username || "", accountData);
    }

    const labels = accounts.map(item => "@" + item.username).join(", ");
    return respond("Instagram conectado!", accounts.length === 1 ? "A conta " + labels + " foi conectada com Login Unificado. O token foi armazenado criptografado no servidor." : accounts.length + " contas foram conectadas: " + labels + ". Os tokens foram armazenados criptografados no servidor.", 200, true);
  } catch (error) {
    console.error("PostFlow3 Instagram Unified Login callback failure", { stage, error_name: error?.name || "Error", error_message: String(error?.message || "erro desconhecido").slice(0, 240) });
    return respond("Erro na conexão", "A falha ocorreu ao " + stage + ". Detalhe: " + String(error?.message || "erro desconhecido").slice(0, 180), 500);
  }
}

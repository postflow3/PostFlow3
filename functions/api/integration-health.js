import { getSession, userKey, decryptJson } from "../_lib/security.js";
import { getSocialAccount, listSocialAccounts } from "../_lib/social-accounts.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

async function checkInstagram(account) {
  if (!account?.access_token || !account?.user_id) {
    return { connected: false, api: "not_checked", message: "Conecte uma conta profissional do Instagram." };
  }
  try {
    const url = new URL("https://graph.instagram.com/v23.0/" + encodeURIComponent(account.user_id));
    url.search = new URLSearchParams({ fields: "user_id,username", access_token: account.access_token }).toString();
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.user_id) {
      return { connected: true, api: "ok", username: String(data.username || account.username || "").slice(0, 100) };
    }
    const message = String(data.error?.message || "A Meta não confirmou o acesso à conta.").slice(0, 180);
    return { connected: true, api: "attention", message, code: data.error?.code ?? null };
  } catch {
    return { connected: true, api: "unknown", message: "Não foi possível consultar a API do Instagram neste momento." };
  }
}

async function checkYouTube(env, account) {
  if (!account?.access_token && !account?.refresh_token) {
    return { connected: false, api: "not_checked", message: "Conecte uma conta do YouTube." };
  }
  let token = account.access_token;
  try {
    const expiry = Number(account.expiry_date || 0);
    if ((!token || (expiry && expiry < Date.now() + 60000)) && account.refresh_token && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      const refreshed = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: account.refresh_token,
          grant_type: "refresh_token"
        })
      });
      const data = await refreshed.json().catch(() => ({}));
      if (refreshed.ok && data.access_token) {
        token = data.access_token;
        const updated = { ...account, ...data, refresh_token: account.refresh_token, expiry_date: Date.now() + Number(data.expires_in || 3600) * 1000 };
        await env.POSTFLOW3_KV.put(userKey(account.__userId, "youtube-owner"), await (await import("../_lib/security.js")).encryptJson(env, updated));
      } else {
        return { connected: true, api: "attention", message: String(data.error_description || data.error || "Não foi possível renovar a autorização Google.").slice(0, 180) };
      }
    }
    if (!token) return { connected: true, api: "attention", message: "A autorização do YouTube precisa ser renovada." };
    const response = await fetch("https://youtube.googleapis.com/youtube/v3/channels?part=id&mine=true", {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(data.items) && data.items.length) return { connected: true, api: "ok" };
    return { connected: true, api: "attention", message: String(data.error?.message || "O YouTube não confirmou o acesso ao canal.").slice(0, 180), code: data.error?.code ?? null };
  } catch {
    return { connected: true, api: "unknown", message: "Não foi possível consultar a API do YouTube neste momento." };
  }
}

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Faça login no PostFlow3 para executar o diagnóstico." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "O armazenamento seguro POSTFLOW3_KV não está configurado neste ambiente." }, 503);

  try {
    const userId = session.userId;
    const accounts = await listSocialAccounts(env, userId);
    const igEntry = accounts.find(a => a.platform === "instagram");
    const ytEntry = accounts.find(a => a.platform === "youtube");
    const [ig, yt] = await Promise.all([
      (async () => {
        const account = await getSocialAccount(env, userId, "instagram", igEntry?.accountId || "");
        return checkInstagram(account);
      })(),
      (async () => {
        const account = await getSocialAccount(env, userId, "youtube", ytEntry?.accountId || "");
        if (account) account.__userId = userId;
        return checkYouTube(env, account);
      })()
    ]);

    return json({
      checkedAt: new Date().toISOString(),
      environment: env.CF_PAGES_BRANCH || "unknown",
      configuration: {
        kv: Boolean(env.POSTFLOW3_KV),
        sessionSecret: Boolean(env.POSTFLOW3_SESSION_SECRET),
        googleOAuth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        instagramApp: Boolean(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET)
      },
      instagram: ig,
      youtube: yt,
      note: "Este diagnóstico verifica configuração, conexão salva e acesso básico às APIs. Ele não garante que toda publicação será aprovada pela Meta ou pelo YouTube."
    });
  } catch {
    return json({ error: "O diagnóstico não conseguiu concluir a verificação. Confira as configurações do ambiente." }, 500);
  }
}

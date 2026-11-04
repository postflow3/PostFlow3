import { getSession } from "../_lib/security.js";
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
    return {
      connected: true,
      api: "attention",
      message: String(data.error?.message || "A Meta não confirmou o acesso à conta.").slice(0, 180),
      code: data.error?.code ?? null
    };
  } catch {
    return { connected: true, api: "unknown", message: "Não foi possível consultar a API do Instagram neste momento." };
  }
}

async function checkYouTube(account) {
  if (!account?.access_token) {
    return {
      connected: Boolean(account?.refresh_token),
      api: "attention",
      message: account?.refresh_token ? "A autorização precisa ser renovada; abra Contas e reconecte o YouTube." : "Conecte uma conta do YouTube."
    };
  }
  try {
    const response = await fetch("https://youtube.googleapis.com/youtube/v3/channels?part=id&mine=true", {
      headers: { Authorization: "Bearer " + account.access_token, Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(data.items) && data.items.length) return { connected: true, api: "ok" };
    return {
      connected: true,
      api: "attention",
      message: String(data.error?.message || "O YouTube não confirmou o acesso ao canal.").slice(0, 180),
      code: data.error?.code ?? null
    };
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
      (async () => checkInstagram(await getSocialAccount(env, userId, "instagram", igEntry?.accountId || "")))(),
      (async () => checkYouTube(await getSocialAccount(env, userId, "youtube", ytEntry?.accountId || "")))()
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

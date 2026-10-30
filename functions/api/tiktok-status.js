import { getSession } from "../_lib/security.js";
import { getSocialAccount, listSocialAccounts } from "../_lib/social-accounts.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Faça login no PostFlow3 para verificar o TikTok." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento seguro não configurado." }, 503);
  const configured = Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
  try {
    const accounts = await listSocialAccounts(env, session.userId);
    const entry = accounts.find(a => a.platform === "tiktok");
    if (!entry) return json({ connected: false, configured, paused: false, api: "not_connected" });
    const account = await getSocialAccount(env, session.userId, "tiktok", entry.accountId);
    if (!account?.access_token) return json({ connected: false, configured, paused: false, api: "attention", message: "A conta salva precisa ser conectada novamente." });
    const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", {
      headers: { Authorization: "Bearer " + account.access_token, Accept: "application/json" }
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.data?.user?.open_id) {
      return json({ connected: true, configured, paused: false, api: "ok", username: String(data.data.user.username || data.data.user.display_name || entry.username || "TikTok").slice(0, 100), scopes: String(account.scope || "") });
    }
    return json({ connected: true, configured, paused: false, api: "attention", message: String(data.error?.message || "O TikTok não confirmou o acesso. Pode ser necessário reconectar a conta.").slice(0, 180), code: data.error?.code || null });
  } catch {
    return json({ connected: Boolean(entry), configured, paused: false, api: "unknown", message: "Não foi possível verificar o TikTok neste momento." });
  }
}

import { getSession, userKey } from "../_lib/security.js";
import { listSocialAccounts, removeSocialAccount } from "../_lib/social-accounts.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Faça login novamente no PostFlow3." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento não configurado." }, 503);
  try {
    const accounts = await listSocialAccounts(env, session.userId);
    // Include legacy single-account connections created before multi-account support.
    for (const platform of ["instagram", "youtube"]) {
      const legacy = await env.POSTFLOW3_KV.get(userKey(session.userId, platform + "-owner"));
      if (!legacy) continue;
      let data;
      try {
        const { decryptJson } = await import("../_lib/security.js");
        data = await decryptJson(env, legacy);
      } catch { continue; }
      const accountId = platform === "instagram" ? String(data.user_id || "") : String(data.channel_id || "");
      if (!accountId || accounts.some(a => a.platform === platform && String(a.accountId) === accountId)) continue;
      accounts.push({
        accountId, platform,
        username: String(data.username || data.channel_title || ""),
        connectedAt: new Date(Number(data.saved_at || Date.now())).toISOString(),
        legacy: true
      });
    }
    return json({ accounts });
  } catch {
    return json({ error: "Não foi possível carregar as contas conectadas." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Faça login novamente no PostFlow3." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento não configurado." }, 503);
  try {
    const input = await request.json();
    await removeSocialAccount(env, session.userId, String(input.platform || ""), String(input.accountId || ""));
    return json({ removed: true });
  } catch (error) {
    return json({ error: String(error?.message || "Não foi possível remover a conta.").slice(0, 200) }, 400);
  }
}

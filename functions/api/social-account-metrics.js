import { getSession } from "../_lib/security.js";
import { getSocialAccount, listSocialAccounts } from "../_lib/social-accounts.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Faça login novamente no PostFlow3." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento não configurado." }, 503);

  try {
    const accounts = await listSocialAccounts(env, session.userId);
    const metrics = await Promise.all(accounts.map(async entry => {
      const result = { platform: entry.platform, accountId: entry.accountId, username: entry.username || entry.accountId, followersCount: null, available: false };
      try {
        const account = await getSocialAccount(env, session.userId, entry.platform, entry.accountId);
        if (!account?.access_token) {
          result.message = "Reconecte esta conta para consultar seguidores.";
          return result;
        }

        if (entry.platform === "instagram") {
          const id = String(account.user_id || entry.accountId || "");
          const url = new URL("https://graph.instagram.com/v23.0/" + encodeURIComponent(id));
          url.search = new URLSearchParams({ fields: "user_id,username,followers_count", access_token: account.access_token }).toString();
          const response = await fetch(url, { headers: { Accept: "application/json" } });
          const data = await response.json().catch(() => ({}));
          if (response.ok && Number.isFinite(Number(data.followers_count))) {
            result.followersCount = Number(data.followers_count);
            result.available = true;
            if (data.username) result.username = data.username;
          } else result.message = String(data.error?.message || "A API do Instagram não disponibilizou seguidores para esta conta.").slice(0, 160);
        } else if (entry.platform === "youtube") {
          const response = await fetch("https://youtube.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", {
            headers: { Authorization: "Bearer " + account.access_token, Accept: "application/json" }
          });
          const data = await response.json().catch(() => ({}));
          const channel = data.items?.[0];
          if (response.ok && channel) {
            result.username = channel.snippet?.title || result.username;
            result.hiddenFollowers = Boolean(channel.statistics?.hiddenSubscriberCount);
            if (!result.hiddenFollowers && channel.statistics?.subscriberCount !== undefined) {
              result.followersCount = Number(channel.statistics.subscriberCount);
              result.available = true;
            } else result.message = "Este canal oculta o número de inscritos.";
          } else result.message = String(data.error?.message || "Não foi possível consultar os inscritos deste canal.").slice(0, 160);
        } else if (entry.platform === "tiktok") {
          const granted = String(account.scope || "").split(/[ ,]+/).includes("user.info.stats");
          if (!granted) {
            result.message = "Reconecte o TikTok após autorizar user.info.stats para consultar seguidores.";
            return result;
          }
          const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,follower_count", {
            headers: { Authorization: "Bearer " + account.access_token, Accept: "application/json" }
          });
          const data = await response.json().catch(() => ({}));
          const user = data.data?.user;
          if (response.ok && user && Number.isFinite(Number(user.follower_count))) {
            result.followersCount = Number(user.follower_count);
            result.available = true;
            result.username = user.username || user.display_name || result.username;
          } else result.message = String(data.error?.message || "O TikTok não disponibilizou seguidores para esta conta.").slice(0, 160);
        }
      } catch {
        result.message = "Não foi possível consultar os seguidores agora.";
      }
      return result;
    }));
    return json({ accounts: metrics, updatedAt: new Date().toISOString() });
  } catch {
    return json({ error: "Não foi possível carregar a contagem de seguidores." }, 500);
  }
}

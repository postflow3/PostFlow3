import { decryptJson, encryptJson } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export async function onRequestPost({ request, env }) {
  const expected = env.POSTFLOW3_SCHEDULER_SECRET;
  if (!expected || request.headers.get("Authorization") !== "Bearer " + expected) return json({ error: "Não autorizado." }, 401);
  if (!env.POSTFLOW3_KV || !env.POSTFLOW3_MEDIA) return json({ error: "Armazenamento não configurado." }, 503);
  const results = [];
  try {
    const list = await env.POSTFLOW3_KV.list({ prefix: "post:", limit: 100 });
    for (const item of list.keys) {
      const post = await env.POSTFLOW3_KV.get(item.name, "json");
      if (!post || post.status !== "scheduled" || new Date(post.scheduledAt).getTime() > Date.now()) continue;
      post.status = "publishing";
      post.attemptedAt = new Date().toISOString();
      await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
      try {
        let tokens = await decryptJson(env, await env.POSTFLOW3_KV.get("youtube-owner"));
        if (!tokens.refresh_token) throw new Error("A conexão do YouTube não tem token de renovação. Reconecte o YouTube.");
        if (!tokens.access_token || !tokens.expires_in || (tokens.saved_at || 0) + tokens.expires_in * 1000 < Date.now() + 60_000) {
          const refreshed = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: "refresh_token" })
          });
          const next = await refreshed.json();
          if (!refreshed.ok || !next.access_token) throw new Error("O Google não renovou a autorização.");
          tokens = { ...tokens, ...next, refresh_token: tokens.refresh_token, saved_at: Date.now() };
          await env.POSTFLOW3_KV.put("youtube-owner", await encryptJson(env, tokens));
        }
        const object = await env.POSTFLOW3_MEDIA.get(post.videoKey);
        if (!object) throw new Error("O arquivo do vídeo não foi encontrado.");
        const metadata = { snippet: { title: post.title, description: post.description || "", categoryId: "22" }, status: { privacyStatus: "public", selfDeclaredMadeForKids: false } };
        const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
          method: "POST", headers: { Authorization: "Bearer " + tokens.access_token, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": post.mimeType, "X-Upload-Content-Length": String(object.size) },
          body: JSON.stringify(metadata)
        });
        const uploadUrl = init.headers.get("Location");
        if (!init.ok || !uploadUrl) throw new Error("O YouTube recusou iniciar o envio do vídeo.");
        const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": post.mimeType, "Content-Length": String(object.size) }, body: await object.arrayBuffer() });
        const video = await uploaded.json().catch(() => ({}));
        if (!uploaded.ok || !video.id) throw new Error(video.error?.message || "O YouTube não concluiu o envio.");
        post.status = "published";
        post.youtubeVideoId = video.id;
        post.youtubeUrl = "https://www.youtube.com/watch?v=" + video.id;
        post.publishedAt = new Date().toISOString();
        await env.POSTFLOW3_MEDIA.delete(post.videoKey);
        await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
        results.push({ id: post.id, status: post.status });
      } catch (e) {
        post.status = "failed";
        post.error = String(e?.message || "Erro ao publicar").slice(0, 300);
        await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
        results.push({ id: post.id, status: post.status, error: post.error });
      }
    }
    return json({ processed: results.length, results });
  } catch { return json({ error: "Erro ao processar a fila." }, 500); }
}

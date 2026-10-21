import { decryptJson, encryptJson, userKey } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function googleAccessToken(env, userId) {
  const raw = await env.POSTFLOW3_KV.get(userKey(userId, "youtube-owner"));
  if (!raw) throw new Error("Conecte novamente a conta Google.");
  let tokens = await decryptJson(env, raw);
  const expiry = Number(tokens.expiry_date || ((tokens.saved_at || 0) + Number(tokens.expires_in || 0) * 1000));
  if (tokens.access_token && expiry > Date.now() + 60000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("A conexão Google não tem token de renovação.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: "refresh_token" })
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) throw new Error("O Google não renovou a autorização.");
  tokens = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000, saved_at: Date.now() };
  await env.POSTFLOW3_KV.put(userKey(userId, "youtube-owner"), await encryptJson(env, tokens));
  return tokens.access_token;
}

export async function onRequestPost({ request, env }) {
  const expected = env.POSTFLOW3_SCHEDULER_SECRET;
  if (!expected || request.headers.get("Authorization") !== "Bearer " + expected) return json({ error: "Não autorizado." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento não configurado." }, 503);
  const results = [];
  try {
    const list = await env.POSTFLOW3_KV.list({ prefix: "user:", limit: 1000 });
    for (const item of list.keys) {
      const ownerMatch = item.name.match(/^user:([0-9a-f-]{36}):post:/i); if (!ownerMatch) continue;
      const userId = ownerMatch[1];
      const post = await env.POSTFLOW3_KV.get(item.name, "json");
      if (!post || post.status !== "scheduled" || new Date(post.scheduledAt).getTime() > Date.now() || !post.videoKey || !env.POSTFLOW3_MEDIA) continue;
      post.status = "publishing";
      post.attemptedAt = new Date().toISOString();
      await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
      try {
        let tokens = await decryptJson(env, await env.POSTFLOW3_KV.get(userKey(userId,"youtube-owner")));
        if (!tokens.refresh_token) throw new Error("A conexão do YouTube não tem token de renovação. Reconecte o YouTube.");
        if (!tokens.access_token || !tokens.expires_in || (tokens.saved_at || 0) + tokens.expires_in * 1000 < Date.now() + 60_000) {
          const refreshed = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: "refresh_token" })
          });
          const next = await refreshed.json();
          if (!refreshed.ok || !next.access_token) throw new Error("O Google não renovou a autorização.");
          tokens = { ...tokens, ...next, refresh_token: tokens.refresh_token, saved_at: Date.now() };
          await env.POSTFLOW3_KV.put(userKey(userId,"youtube-owner"), await encryptJson(env, tokens));
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
    // Publish Instagram destinations whose scheduled time has arrived. YouTube
    // already handles its own native scheduled publication in this deployment.
    for (const item of list.keys) {
      const ownerMatch = item.name.match(/^user:([0-9a-f-]{36}):post:/i); if (!ownerMatch) continue;
      const userId = ownerMatch[1];
      const post = await env.POSTFLOW3_KV.get(item.name, "json");
      if (!post || post.status !== "scheduled_on_youtube" || post.instagramStatus !== "scheduled" ||
          !post.instagramVideoKey || new Date(post.scheduledAt).getTime() > Date.now()) continue;
      post.instagramStatus = "publishing";
      post.instagramAttemptedAt = new Date().toISOString();
      await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
      try {
        const saved = await env.POSTFLOW3_KV.get(userKey(userId,"instagram-owner"));
        if (!saved) throw new Error("Conecte novamente o Instagram.");
        const account = await decryptJson(env, saved);
        if (!account.access_token || !account.user_id) throw new Error("A conexão do Instagram está incompleta.");
        const key = post.instagramVideoKey;
        const secret = env.POSTFLOW3_SESSION_SECRET;
        if (!secret) throw new Error("A assinatura segura do vídeo não está configurada.");
        const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode("instagram-media:" + key)));
        const sig = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
        const mediaUrl = new URL("/api/instagram-media", request.url);
        mediaUrl.searchParams.set("key", key); mediaUrl.searchParams.set("sig", sig);
        const createResponse = await fetch("https://graph.instagram.com/v23.0/" + encodeURIComponent(account.user_id) + "/media", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ media_type: "REELS", video_url: mediaUrl.toString(), caption: String(post.description || "").slice(0, 2200), access_token: account.access_token })
        });
        const created = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok || !created.id) throw new Error(created.error?.message || "O Instagram recusou criar a publicação.");
        let ready = false, lastStatus = "";
        for (let i = 0; i < 8; i++) {
          const statusUrl = new URL("https://graph.instagram.com/v23.0/" + encodeURIComponent(created.id));
          statusUrl.searchParams.set("fields", "status_code,status"); statusUrl.searchParams.set("access_token", account.access_token);
          const sr = await fetch(statusUrl), sd = await sr.json().catch(() => ({}));
          if (sr.ok && sd.status_code === "FINISHED") { ready = true; break; }
          if (sd.status_code === "ERROR") throw new Error(sd.status || "O Instagram não conseguiu processar o vídeo.");
          lastStatus = sd.status || sd.status_code || "processando";
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        if (!ready) throw new Error("O Instagram ainda está processando o vídeo (" + lastStatus + ").");
        const publishResponse = await fetch("https://graph.instagram.com/v23.0/" + encodeURIComponent(account.user_id) + "/media_publish", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ creation_id: created.id, access_token: account.access_token })
        });
        const published = await publishResponse.json().catch(() => ({}));
        if (!publishResponse.ok || !published.id) throw new Error(published.error?.message || "O Instagram não confirmou a publicação.");
        post.instagramStatus = "published";
        post.instagramMediaId = published.id;
        post.instagramPublishedAt = new Date().toISOString();
        try {
          const pu = new URL("https://graph.instagram.com/v23.0/" + encodeURIComponent(published.id));
          pu.searchParams.set("fields", "permalink"); pu.searchParams.set("access_token", account.access_token);
          const pr = await fetch(pu), pd = await pr.json().catch(() => ({}));
          if (pd.permalink) post.instagramUrl = pd.permalink;
        } catch {}
        const driveMetaKey = userKey(userId, "instagram-drive:" + key.split("/").pop());
        const driveMetaRaw = await env.POSTFLOW3_KV.get(driveMetaKey);
        if (driveMetaRaw) {
          const driveMeta = JSON.parse(driveMetaRaw);
          try {
            const googleToken = await googleAccessToken(env, userId);
            const deleted = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(driveMeta.fileId), { method: "DELETE", headers: { Authorization: "Bearer " + googleToken } });
            if (deleted.ok || deleted.status === 404) {
              await env.POSTFLOW3_KV.delete(driveMetaKey);
              post.driveSourceDeleted = true;
              post.driveCleanupPending = false;
            } else {
              const deleteError = await deleted.json().catch(() => ({}));
              post.driveCleanupPending = true;
              post.driveCleanupError = deleteError.error?.message || "Publicação concluída, mas não foi possível apagar o original do Drive.";
            }
          } catch (cleanupError) {
            post.driveCleanupPending = true;
            post.driveCleanupError = String(cleanupError?.message || "Não foi possível apagar o original do Drive.").slice(0, 250);
          }
        }
        results.push({ id: post.id, platform: "Instagram", status: "published", driveCleanupPending: Boolean(post.driveCleanupPending) });
      } catch (e) {
        post.instagramStatus = "failed";
        post.instagramError = String(e?.message || "Erro ao publicar no Instagram.").slice(0, 300);
        results.push({ id: post.id, platform: "Instagram", status: "failed", error: post.instagramError });
      }
      await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
    }
    // Check YouTube-native scheduled uploads and delete the Drive source only after YouTube reports public.
    for (const item of list.keys) {
      const ownerMatch = item.name.match(/^user:([0-9a-f-]{36}):post:/i); if (!ownerMatch) continue;
      const userId = ownerMatch[1];
      const post = await env.POSTFLOW3_KV.get(item.name, "json");
      if (!post || post.status !== "scheduled_on_youtube" || !post.driveFileId || post.driveSourceDeleted ||
          !post.scheduledAt || new Date(post.scheduledAt).getTime() > Date.now()) continue;
      try {
        const googleToken = await googleAccessToken(env, userId);
        const check = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status&id=" + encodeURIComponent(post.youtubeVideoId || ""), { headers: { Authorization: "Bearer " + googleToken } });
        const data = await check.json().catch(() => ({}));
        const videoStatus = data.items?.[0]?.status?.privacyStatus;
        if (!check.ok) throw new Error(data.error?.message || "Não foi possível confirmar o estado do vídeo no YouTube.");
        if (videoStatus !== "public") continue;
        const deleted = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(post.driveFileId), { method: "DELETE", headers: { Authorization: "Bearer " + googleToken } });
        if (deleted.ok || deleted.status === 404) {
          post.driveSourceDeleted = true;
          post.driveCleanupPending = false;
          post.driveDeletedAt = new Date().toISOString();
          await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
          results.push({ id: post.id, platform: "YouTube", status: "published", driveSourceDeleted: true });
        } else {
          const deleteError = await deleted.json().catch(() => ({}));
          post.driveCleanupPending = true;
          post.driveCleanupError = deleteError.error?.message || "Não foi possível apagar o original do Drive.";
          await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
        }
      } catch (cleanupError) {
        post.driveCleanupPending = true;
        post.driveCleanupError = String(cleanupError?.message || "Não foi possível confirmar a publicação para limpar o Drive.").slice(0, 250);
        await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
      }
    }
    return json({ processed: results.length, results });
  } catch { return json({ error: "Erro ao processar a fila." }, 500); }
}

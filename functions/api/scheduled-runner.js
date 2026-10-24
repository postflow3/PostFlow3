import { decryptJson, encryptJson, userKey } from "../_lib/security.js";
import { getSocialAccount, socialAccountKey } from "../_lib/social-accounts.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const due = post => post.publicationMode === "immediate" || !post.scheduledAt || new Date(post.scheduledAt).getTime() <= Date.now();
const hasPlatform = (post, platform) => Array.isArray(post.platforms) ? post.platforms.includes(platform) : platform === "YouTube" ? Boolean(post.youtubeVideoId) : Boolean(post.instagramVideoKey);

async function googleAccessToken(env, userId, accountId = "") {
  let tokens = await getSocialAccount(env, userId, "youtube", accountId);
  if (!tokens) throw new Error("Conecte novamente a conta YouTube selecionada.");
  const key = accountId ? socialAccountKey(userId, "youtube", accountId) : userKey(userId, "youtube-owner");
  const expiry = Number(tokens.expiry_date || ((tokens.saved_at || 0) + Number(tokens.expires_in || 0) * 1000));
  if (tokens.access_token && expiry > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("A conexão Google não tem token de renovação.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: tokens.refresh_token, grant_type: "refresh_token" })
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) throw new Error(refreshed.error_description || "O Google não renovou a autorização.");
  tokens = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000, saved_at: Date.now() };
  await env.POSTFLOW3_KV.put(key, await encryptJson(env, tokens));
  return tokens.access_token;
}

async function instagramSignature(env, key) {
  if (!env.POSTFLOW3_SESSION_SECRET) throw new Error("A assinatura segura do vídeo não está configurada.");
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.POSTFLOW3_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode("instagram-media:" + key)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function publishInstagramStep({ request, env, userId, post }) {
  const videoKey = String(post.instagramVideoKey || "");
  if (!new RegExp("^instagram-media/" + userId + "/[0-9a-f-]{36}$", "i").test(videoKey)) throw new Error("O vídeo salvo para o Instagram não foi encontrado.");
  const account = await getSocialAccount(env, userId, "instagram", String(post.instagramAccountId || ""));
  if (!account) throw new Error("Conecte novamente a conta Instagram selecionada.");
  if (!account.access_token || !account.user_id) throw new Error("A conexão do Instagram está incompleta.");
  let creationId = post.instagramCreationId;
  if (!creationId) {
    const mediaUrl = new URL("/api/instagram-media", request.url);
    mediaUrl.searchParams.set("key", videoKey);
    mediaUrl.searchParams.set("sig", await instagramSignature(env, videoKey));
    const response = await fetch("https://graph.instagram.com/v23.0/" + encodeURIComponent(account.user_id) + "/media", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ media_type: "REELS", video_url: mediaUrl.toString(), caption: String(post.description || "").slice(0, 2200), access_token: account.access_token })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) throw new Error(data.error?.message || "O Instagram recusou criar a publicação.");
    creationId = data.id;
    post.instagramCreationId = creationId;
    post.instagramStatus = "processing";
    post.instagramAttemptedAt = new Date().toISOString();
    await env.POSTFLOW3_KV.put(userKey(userId, "post:" + post.id), JSON.stringify(post));
  }

  const statusUrl = new URL("https://graph.instagram.com/v23.0/" + encodeURIComponent(creationId));
  statusUrl.searchParams.set("fields", "status_code,status");
  statusUrl.searchParams.set("access_token", account.access_token);
  const statusResponse = await fetch(statusUrl);
  const statusData = await statusResponse.json().catch(() => ({}));
  if (!statusResponse.ok) {
    post.instagramStatus = "processing";
    post.instagramError = String(statusData.error?.message || "O Instagram ainda não retornou o estado do vídeo.").slice(0, 250);
    return "processing";
  }
  if (statusData.status_code === "ERROR") {
    post.instagramStatus = "failed";
    post.instagramError = String(statusData.status || "O Instagram não conseguiu processar o vídeo.").slice(0, 250);
    return "failed";
  }
  if (statusData.status_code !== "FINISHED") {
    post.instagramStatus = "processing";
    post.instagramProcessingStatus = String(statusData.status_code || statusData.status || "IN_PROGRESS").slice(0, 80);
    return "processing";
  }

  const publishResponse = await fetch("https://graph.instagram.com/v23.0/" + encodeURIComponent(account.user_id) + "/media_publish", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: creationId, access_token: account.access_token })
  });
  const published = await publishResponse.json().catch(() => ({}));
  if (!publishResponse.ok || !published.id) {
    post.instagramStatus = "failed";
    post.instagramError = String(published.error?.message || "O Instagram não confirmou a publicação. Confira o perfil antes de tentar novamente.").slice(0, 250);
    return "failed";
  }
  post.instagramStatus = "published";
  post.instagramMediaId = published.id;
  post.instagramPublishedAt = new Date().toISOString();
  post.instagramCreationId = null;
  post.instagramError = null;
  try {
    const permalinkUrl = new URL("https://graph.instagram.com/v23.0/" + encodeURIComponent(published.id));
    permalinkUrl.searchParams.set("fields", "permalink");
    permalinkUrl.searchParams.set("access_token", account.access_token);
    const permalinkResponse = await fetch(permalinkUrl);
    const permalinkData = await permalinkResponse.json().catch(() => ({}));
    if (permalinkData.permalink) post.instagramUrl = permalinkData.permalink;
  } catch {}
  return "published";
}

async function checkYoutubePublication(env, userId, post) {
  const token = await googleAccessToken(env, userId, String(post.youtubeAccountId || ""));
  const response = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status&id=" + encodeURIComponent(post.youtubeVideoId), { headers: { Authorization: "Bearer " + token } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Não foi possível confirmar o estado do vídeo no YouTube.");
  const item = data.items?.[0];
  if (item?.status?.privacyStatus === "public") {
    post.youtubeStatus = "published";
    post.youtubePublishedAt = post.youtubePublishedAt || new Date().toISOString();
    post.youtubeCheckError = null;
    return true;
  }
  post.youtubeStatus = item?.status?.privacyStatus || "processing";
  return false;
}

async function cleanupDriveIfComplete(env, userId, post) {
  const hasYoutube = hasPlatform(post, "YouTube") || Boolean(post.youtubeVideoId);
  const hasInstagram = hasPlatform(post, "Instagram") || Boolean(post.instagramVideoKey);
  const youtubeDone = !hasYoutube || post.youtubeStatus === "published";
  const instagramDone = !hasInstagram || post.instagramStatus === "published" || post.status === "published_on_instagram";
  if (!youtubeDone || !instagramDone || post.driveSourceDeleted) return false;

  let fileId = post.driveFileId || "";
  let metadataKey = "";
  if (!fileId && post.instagramVideoKey) {
    const videoId = post.instagramVideoKey.split("/").pop();
    metadataKey = userKey(userId, "instagram-drive:" + videoId);
    const raw = await env.POSTFLOW3_KV.get(metadataKey);
    if (raw) {
      try { fileId = JSON.parse(raw).fileId || ""; } catch {}
    }
  }
  const token = await googleAccessToken(env, userId, String(post.youtubeAccountId || ""));
  if (!fileId && post.filename && Number(post.size) > 0) {
    // Recover legacy posts only if filename + size identify exactly one Drive file.
    const escapedName = String(post.filename).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const query = "name = '" + escapedName + "' and trashed = false";
    const lookupUrl = new URL("https://www.googleapis.com/drive/v3/files");
    lookupUrl.searchParams.set("q", query);
    lookupUrl.searchParams.set("pageSize", "100");
    lookupUrl.searchParams.set("fields", "nextPageToken,files(id,name,size,mimeType)");
    const lookup = await fetch(lookupUrl, { headers: { Authorization: "Bearer " + token } });
    const lookupData = await lookup.json().catch(() => ({}));
    const exactMatches = Array.isArray(lookupData.files)
      ? lookupData.files.filter(file => String(file.size || "") === String(Math.floor(Number(post.size))) && String(file.mimeType || "").startsWith("video/"))
      : [];
    if (lookup.ok && !lookupData.nextPageToken && exactMatches.length === 1 && exactMatches[0].id) {
      fileId = String(exactMatches[0].id);
      post.driveFileId = fileId;
    } else {
      post.driveCleanupPending = true;
      post.driveCleanupError = !lookup.ok
        ? String(lookupData.error?.message || "Não foi possível localizar com segurança o original no Google Drive. O arquivo foi mantido.").slice(0, 250)
        : (lookupData.nextPageToken || exactMatches.length > 1
          ? "Há vários arquivos possíveis com o mesmo nome e tamanho no Google Drive. Nenhum foi apagado para evitar excluir o arquivo errado."
          : "Não encontrei um único vídeo com o mesmo nome e tamanho no Google Drive. O arquivo foi mantido.");
      return false;
    }
  }
  if (!fileId) {
    if (post.driveCleanupPending || post.driveFileId || post.instagramVideoKey) {
      post.driveCleanupPending = true;
      post.driveCleanupError = "Publicação confirmada, mas o identificador do arquivo original no Drive não está disponível. O arquivo foi mantido.";
    }
    return false;
  }
  const response = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId), { method: "DELETE", headers: { Authorization: "Bearer " + token } });
  if (response.ok || response.status === 404) {
    if (metadataKey) await env.POSTFLOW3_KV.delete(metadataKey);
    post.driveSourceDeleted = true;
    post.driveCleanupPending = false;
    post.driveCleanupError = null;
    post.driveDeletedAt = new Date().toISOString();
    return true;
  }
  const data = await response.json().catch(() => ({}));
  post.driveCleanupPending = true;
  post.driveCleanupError = String(data.error?.message || "Não foi possível apagar o original do Google Drive.").slice(0, 250);
  return false;
}

export async function onRequestPost({ request, env }) {
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento KV não configurado." }, 503);
  const configuredSecret = env.POSTFLOW3_SCHEDULER_SECRET;
  const expected = configuredSecret || await env.POSTFLOW3_KV.get("system:scheduler-secret");
  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied !== expected) return json({ error: "Não autorizado." }, 401);

  const lockKey = "system:scheduler-lock";
  const now = Date.now();
  const currentLock = await env.POSTFLOW3_KV.get(lockKey, "json");
  if (currentLock?.until > now) return json({ busy: true, processed: 0, message: "Outra execução ainda está em andamento." }, 200);
  const runId = crypto.randomUUID();
  await env.POSTFLOW3_KV.put(lockKey, JSON.stringify({ runId, until: now + 4 * 60 * 1000 }), { expirationTtl: 300 });

  const results = [];
  try {
    const keys = [];
    let cursor;
    do {
      const page = await env.POSTFLOW3_KV.list({ prefix: "user:", limit: 1000, cursor });
      keys.push(...page.keys.filter(key => /^user:[0-9a-f-]{36}:post:/i.test(key.name)));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    for (const item of keys) {
      const match = item.name.match(/^user:([0-9a-f-]{36}):post:/i);
      if (!match) continue;
      const userId = match[1];
      let post = await env.POSTFLOW3_KV.get(item.name, "json");
      if (!post) continue;
      let changed = false;
      const isDue = due(post);

      if (post.youtubeVideoId && hasPlatform(post, "YouTube") && isDue && post.youtubeStatus !== "published") {
        try {
          const wasPublished = post.youtubeStatus === "published";
          await checkYoutubePublication(env, userId, post);
          changed = true;
          if (!wasPublished && post.youtubeStatus === "published") results.push({ id: post.id, platform: "YouTube", status: "published" });
        } catch (error) {
          post.youtubeCheckError = String(error?.message || "Falha ao consultar YouTube.").slice(0, 250);
          changed = true;
          results.push({ id: post.id, platform: "YouTube", status: "check_pending", error: post.youtubeCheckError });
        }
      }

      const instagramDue = post.instagramVideoKey && hasPlatform(post, "Instagram") && isDue;
      if (instagramDue && !["published", "failed"].includes(post.instagramStatus)) {
        try {
          const before = post.instagramStatus;
          const state = await publishInstagramStep({ request, env, userId, post });
          changed = true;
          results.push({ id: post.id, platform: "Instagram", status: state });
          if (before !== "published" && state === "published") post.instagramError = null;
        } catch (error) {
          post.instagramStatus = "failed";
          post.instagramError = String(error?.message || "Falha ao publicar no Instagram.").slice(0, 250);
          changed = true;
          results.push({ id: post.id, platform: "Instagram", status: "failed", error: post.instagramError });
        }
      }

      const beforeCleanup = JSON.stringify(post);
      try {
        const deleted = await cleanupDriveIfComplete(env, userId, post);
        if (deleted) results.push({ id: post.id, platform: "Google Drive", status: "source_deleted_after_publication" });
        if (JSON.stringify(post) !== beforeCleanup) changed = true;
      } catch (error) {
        post.driveCleanupPending = true;
        post.driveCleanupError = String(error?.message || "Falha ao limpar o arquivo do Drive.").slice(0, 250);
        changed = true;
      }

      const hasYoutube = hasPlatform(post, "YouTube") || Boolean(post.youtubeVideoId);
      const hasInstagram = hasPlatform(post, "Instagram") || Boolean(post.instagramVideoKey);
      if ((!hasYoutube || post.youtubeStatus === "published") && (!hasInstagram || post.instagramStatus === "published") && post.status !== "published") {
        post.status = "published";
        post.publishedAt = post.publishedAt || new Date().toISOString();
        changed = true;
      }
      if (changed) await env.POSTFLOW3_KV.put(item.name, JSON.stringify(post));
    }
    return json({ processed: results.length, results, checkedPosts: keys.length, at: new Date().toISOString() });
  } catch (error) {
    return json({ error: String(error?.message || "Erro ao processar a fila.").slice(0, 300) }, 500);
  } finally {
    const lock = await env.POSTFLOW3_KV.get(lockKey, "json");
    if (lock?.runId === runId) await env.POSTFLOW3_KV.delete(lockKey);
  }
}

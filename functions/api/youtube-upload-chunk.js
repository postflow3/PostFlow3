import { getSession, decryptJson, encryptJson, userKey } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

async function token(env,userId) {
  const saved = await env.POSTFLOW3_KV.get(userKey(userId,"youtube-owner"));
  if (!saved) throw new Error("Conecte a conta Google/YouTube novamente.");
  let t = await decryptJson(env, saved);
  const expires = Number(t.expiry_date || ((t.saved_at || 0) + Number(t.expires_in || 0) * 1000));
  if (t.access_token && expires > Date.now() + 60000) return t.access_token;
  if (!t.refresh_token) throw new Error("A autorização Google expirou. Reconecte o YouTube.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: t.refresh_token, grant_type: "refresh_token" })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("Não foi possível renovar a autorização Google.");
  t = { ...t, ...d, refresh_token: t.refresh_token, expiry_date: Date.now() + Number(d.expires_in || 3600) * 1000, saved_at: Date.now() };
  await env.POSTFLOW3_KV.put(userKey(userId,"youtube-owner"), await encryptJson(env, t));
  return t.access_token;
}

export async function onRequestPost({ request, env }) {
  const session=await getSession(request,env);if(!session)return json({error:"Sua sessão expirou. Entre novamente no PostFlow3."},401);
  if (!env.POSTFLOW3_KV || !env.POSTFLOW3_SESSION_SECRET || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: "A configuração segura do YouTube está incompleta." }, 503);
  try {
    const uploadId = request.headers.get("X-PostFlow-Upload-Id") || "";
    const start = Number(request.headers.get("X-Chunk-Start"));
    const end = Number(request.headers.get("X-Chunk-End"));
    const total = Number(request.headers.get("X-Upload-Total"));
    if (!/^[0-9a-f-]{36}$/i.test(uploadId) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || start < 0 || end < start || end >= total) {
      return json({ error: "Informações do trecho inválidas." }, 400);
    }
    const raw = await env.POSTFLOW3_KV.get(userKey(session.userId,"youtube-upload:" + uploadId));
    if (!raw) return json({ error: "Sessão de envio não encontrada ou expirada. Inicie o envio novamente." }, 404);
    const pending = await decryptJson(env, raw);
    if (pending.uploadId !== uploadId || pending.size !== total) return json({ error: "O trecho não corresponde ao vídeo selecionado." }, 409);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength !== end - start + 1 || bytes.byteLength > 8 * 1024 * 1024) return json({ error: "O tamanho do trecho não corresponde ao esperado." }, 400);

    const response = await fetch(pending.uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + await token(env,session.userId),
        "Content-Type": pending.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Range": "bytes " + start + "-" + end + "/" + total
      },
      body: bytes
    });
    if (response.status === 308) {
      const range = response.headers.get("Range") || "";
      const match = range.match(/bytes=0-(\d+)/);
      const received = match ? Number(match[1]) + 1 : 0;
      return json({ complete: false, received, nextOffset: received, message: "Trecho recebido pelo YouTube." });
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) {
      if (response.status >= 500) return json({ error: result.error?.message || "Falha temporária no YouTube. Tente novamente para continuar o envio." }, 503);
      return json({ error: result.error?.message || "O YouTube recusou este trecho. Verifique o vídeo e a conexão." }, 502);
    }

    const post = {
      id: crypto.randomUUID(), title: pending.title, description: pending.description,
      filename: pending.filename, mimeType: pending.mimeType, size: pending.size,
      scheduledAt: pending.scheduledAt,
      publicationMode: pending.publicationMode || "scheduled",
      status: pending.publicationMode === "immediate" ? "published_on_youtube" : "scheduled_on_youtube",
      youtubeVideoId: result.id, youtubeUrl: "https://www.youtube.com/watch?v=" + result.id,
      createdAt: pending.createdAt, uploadedAt: new Date().toISOString(), platforms: pending.publishInstagram ? ["YouTube", "Instagram"] : ["YouTube"], instagramVideoKey: pending.publishInstagram ? pending.instagramVideoKey : null, driveFileId: pending.publishInstagram ? (pending.driveFileId || null) : null, driveCleanupPending: true, instagramStatus: pending.publishInstagram ? (pending.publicationMode === "immediate" ? "pending" : "scheduled") : null
    };
    await env.POSTFLOW3_KV.put(userKey(session.userId,"post:" + post.id), JSON.stringify(post));
    await env.POSTFLOW3_KV.put(userKey(session.userId,"youtube-upload:" + uploadId), await encryptJson(env, { ...pending, status: "complete", youtubeVideoId: result.id, completedAt: new Date().toISOString() }), { expirationTtl: 604800 });
    return json({ complete: true, received: total, post, message: pending.publicationMode === "immediate" ? "O YouTube confirmou o envio para publicação imediata. Confira o canal para verificar a disponibilidade pública." : "O YouTube confirmou o vídeo. Ele está privado e agendado para a data escolhida." }, 201);
  } catch (e) {
    return json({ error: String(e?.message || "Falha ao enviar trecho ao YouTube.").slice(0, 350) }, 500);
  }
}

import { getSession, decryptJson, encryptJson, userKey } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

async function getAccessToken(env,userId) {
  const encrypted = await env.POSTFLOW3_KV.get(userKey(userId,"youtube-owner"));
  if (!encrypted) throw new Error("Conecte a conta Google/YouTube no PostFlow3.");
  let tokens = await decryptJson(env, encrypted);
  const expiry = Number(tokens.expiry_date || ((tokens.saved_at || 0) + Number(tokens.expires_in || 0) * 1000));
  if (tokens.access_token && expiry > Date.now() + 60_000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("A autorização não tem token de renovação. Reconecte o YouTube.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: "refresh_token"
    })
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.access_token) throw new Error("O Google não renovou a autorização. Reconecte o YouTube.");
  tokens = {
    ...tokens, ...refreshed, refresh_token: tokens.refresh_token,
    expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
    saved_at: Date.now()
  };
  await env.POSTFLOW3_KV.put(userKey(userId,"youtube-owner"), await encryptJson(env, tokens));
  return tokens.access_token;
}

export async function onRequestPost({ request, env }) {
  const session=await getSession(request,env);if(!session)return json({error:"Sua sessão expirou. Entre novamente no PostFlow3."},401);
  if (!env.POSTFLOW3_KV || !env.TOKEN_ENCRYPTION_KEY || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json({ error: "A configuração segura do YouTube/KV está incompleta." }, 503);
  }
  try {
    const input = await request.json();
    const title = String(input.title || "").trim().slice(0, 100);
    const description = String(input.description || "").trim().slice(0, 5000);
    const filename = String(input.filename || "video.mp4").trim().slice(0, 200);
    const mimeType = String(input.mimeType || "").trim().toLowerCase();
    const size = Number(input.size);
    const publicationMode = input.publicationMode === "immediate" ? "immediate" : "scheduled";
    const scheduledAt = String(input.scheduledAt || "").trim();
    const instagramVideoKey = String(input.instagramVideoKey || "").trim();
    const publishInstagram = input.publishInstagram === true;
    if (publishInstagram && !new RegExp("^instagram-media/"+session.userId+"/[0-9a-f-]{36}$","i").test(instagramVideoKey)) return json({ error: "O vídeo do Instagram não foi preparado corretamente." }, 400);
    const date = scheduledAt ? new Date(scheduledAt) : null;

    if (!title) return json({ error: "Digite o título do vídeo." }, 400);
    if (!Number.isSafeInteger(size) || size <= 0) return json({ error: "O tamanho do arquivo não é válido." }, 400);
    if (!(mimeType.startsWith("video/") || mimeType === "application/octet-stream")) return json({ error: "Escolha um arquivo de vídeo válido." }, 400);
    if (publicationMode === "scheduled" && (!scheduledAt || !date || Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 10 * 60_000)) {
      return json({ error: "Escolha um horário pelo menos 10 minutos no futuro para permitir o envio e processamento." }, 400);
    }

    const accessToken = await getAccessToken(env,session.userId);
    const status = publicationMode === "immediate"
      ? { privacyStatus: "public", selfDeclaredMadeForKids: false }
      : { privacyStatus: "private", publishAt: date.toISOString(), selfDeclaredMadeForKids: false };
    const metadata = {
      snippet: { title, description, categoryId: "22" },
      status
    };
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(size)
      },
      body: JSON.stringify(metadata)
    });
    const uploadUrl = init.headers.get("Location");
    if (!init.ok || !uploadUrl) {
      const error = await init.json().catch(() => ({}));
      return json({ error: error.error?.message || "O YouTube não aceitou iniciar o envio. Confira a conexão, a API e a cota do Google." }, 502);
    }

    const uploadId = crypto.randomUUID();
    const pending = {
      uploadId, uploadUrl, title, description, filename, mimeType, size,
      publicationMode, instagramVideoKey: publishInstagram ? instagramVideoKey : null, publishInstagram,
      scheduledAt: publicationMode === "scheduled" ? date.toISOString() : null,
      createdAt: new Date().toISOString(),
      status: "uploading"
    };
    await env.POSTFLOW3_KV.put(userKey(session.userId,"youtube-upload:" + uploadId), await encryptJson(env, pending), { expirationTtl: 604800 });
    return json({ uploadId, chunkSize: 8 * 1024 * 1024, message: "Sessão de envio criada para o canal do YouTube conectado." }, 201);
  } catch (error) {
    return json({ error: String(error?.message || "Não foi possível iniciar o envio.").slice(0, 350) }, 500);
  }
}

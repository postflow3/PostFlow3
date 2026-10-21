import { getSession, decryptJson, encryptJson, userKey } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

async function getTokens(env,userId) {
  const encrypted = await env.POSTFLOW3_KV.get(userKey(userId,"youtube-owner"));
  if (!encrypted) throw new Error("Conecte sua conta Google novamente.");
  let tokens = await decryptJson(env, encrypted);
  const expiry = Number(tokens.expiry_date || ((tokens.saved_at || 0) + Number(tokens.expires_in || 0) * 1000));
  if (tokens.access_token && expiry > Date.now() + 60_000) return tokens;
  if (!tokens.refresh_token) throw new Error("A autorização Google não tem token de renovação. Reconecte a conta.");
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
  if (!response.ok || !refreshed.access_token) throw new Error("Não foi possível renovar a autorização Google.");
  tokens = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000, saved_at: Date.now() };
  await env.POSTFLOW3_KV.put(userKey(userId,"youtube-owner"), await encryptJson(env, tokens));
  return tokens;
}

export async function onRequestPost({ request, env }) {
  const session=await getSession(request,env);if(!session)return json({error:"Faça login novamente no PostFlow3."},401);
  if (!env.POSTFLOW3_KV || !env.TOKEN_ENCRYPTION_KEY || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json({ error: "A configuração Google/KV está incompleta." }, 503);
  }
  try {
    const input = await request.json();
    const fileId = String(input.fileId || "").trim();
    const title = String(input.title || "").trim().slice(0, 100);
    const description = String(input.description || "").trim().slice(0, 5000);
    const publicationMode = input.publicationMode === "immediate" ? "immediate" : "scheduled";
    const scheduledAt = String(input.scheduledAt || "").trim();
    const date = scheduledAt ? new Date(scheduledAt) : null;
    if (!fileId || !title) return json({ error: "Escolha um vídeo do Drive e informe o título." }, 400);
    if (publicationMode === "scheduled" && (!scheduledAt || !date || Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 10 * 60_000)) {
      return json({ error: "Escolha um horário pelo menos 10 minutos no futuro." }, 400);
    }
    const tokens = await getTokens(env,session.userId);
    const auth = { Authorization: "Bearer " + tokens.access_token };
    const driveMetaResponse = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?fields=id,name,mimeType,size,trashed", { headers: auth });
    const meta = await driveMetaResponse.json();
    if (!driveMetaResponse.ok) return json({ error: meta.error?.message || "Não consegui acessar esse arquivo do Drive. Verifique a permissão do Google Drive." }, 502);
    if (meta.trashed || !String(meta.mimeType || "").startsWith("video/")) return json({ error: "O arquivo escolhido não é um vídeo disponível no Drive." }, 400);
    const size = Number(meta.size || 0);
    if (!size) return json({ error: "O Drive não informou o tamanho do vídeo; não posso iniciar o envio com segurança." }, 400);
    const metadata = {
      snippet: { title, description, categoryId: "22" },
      status: publicationMode === "immediate"
        ? { privacyStatus: "public", selfDeclaredMadeForKids: false }
        : { privacyStatus: "private", publishAt: date.toISOString(), selfDeclaredMadeForKids: false }
    };
    const initResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": meta.mimeType,
        "X-Upload-Content-Length": String(size)
      },
      body: JSON.stringify(metadata)
    });
    const uploadUrl = initResponse.headers.get("Location");
    if (!initResponse.ok || !uploadUrl) {
      const err = await initResponse.json().catch(() => ({}));
      return json({ error: err.error?.message || "O YouTube não aceitou criar o agendamento. Confira as permissões e a cota da API." }, 502);
    }
    const mediaResponse = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media", { headers: auth });
    if (!mediaResponse.ok || !mediaResponse.body) {
      return json({ error: "Não consegui baixar o conteúdo do vídeo no Drive. Nenhum agendamento foi confirmado." }, 502);
    }
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": meta.mimeType, "Content-Length": String(size) },
      body: mediaResponse.body
    });
    const uploaded = await uploadResponse.json().catch(() => ({}));
    if (!uploadResponse.ok || !uploaded.id) {
      return json({ error: uploaded.error?.message || "O YouTube não confirmou o envio do vídeo. Verifique o canal antes de tentar novamente." }, 502);
    }
    const post = {
      id: crypto.randomUUID(),
      title,
      description,
      filename: meta.name || "Vídeo do Google Drive",
      driveFileId: meta.id,
      mimeType: meta.mimeType,
      size,
      scheduledAt: publicationMode === "scheduled" ? date.toISOString() : null,
      publicationMode,
      status: publicationMode === "immediate" ? "published_on_youtube" : "scheduled_on_youtube",
      youtubeVideoId: uploaded.id,
      youtubeUrl: "https://www.youtube.com/watch?v=" + uploaded.id,
      createdAt: new Date().toISOString(),
      platforms: ["YouTube"]
    };
    await env.POSTFLOW3_KV.put(userKey(session.userId,"post:" + post.id), JSON.stringify(post));
    return json({ post, message: publicationMode === "immediate" ? "O YouTube confirmou o envio para publicação imediata. Confira o canal para verificar a disponibilidade pública." : "O YouTube confirmou o vídeo como privado e agendado. Confira o agendamento no YouTube Studio." }, 201);
  } catch (error) {
    return json({ error: String(error?.message || "Falha ao agendar vídeo do Drive.").slice(0, 400) }, 500);
  }
}

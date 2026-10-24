import { getSession, decryptJson, userKey } from "../_lib/security.js";
import { getSocialAccount } from "../_lib/social-accounts.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Sua sessão expirou. Entre novamente no PostFlow3." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "O armazenamento do PostFlow3 não está configurado." }, 503);

  try {
    const input = await request.json();
    const videoKey = String(input.videoKey || "").trim();
    const accountId = String(input.accountId || "").trim().slice(0,180);
    const driveFileId = String(input.driveFileId || "").trim();
    const title = String(input.title || "Vídeo do Instagram").trim().slice(0, 100);
    const description = String(input.caption || input.description || "").trim().slice(0, 2200);
    const filename = String(input.filename || "video.mp4").trim().slice(0, 200);
    const size = Number(input.size);
    const scheduledAt = String(input.scheduledAt || "").trim();
    const date = new Date(scheduledAt);

    if (!new RegExp("^instagram-media/" + session.userId + "/[0-9a-f-]{36}$", "i").test(videoKey)) {
      return json({ error: "O vídeo preparado para o Instagram não foi encontrado." }, 400);
    }
    if (!/^[\w-]{10,200}$/.test(driveFileId)) {
      return json({ error: "Não foi possível identificar o vídeo salvo no Google Drive." }, 400);
    }
    if (!Number.isSafeInteger(size) || size <= 0 || size > 80 * 1024 * 1024) {
      return json({ error: "O tamanho do vídeo não é válido para o Instagram." }, 400);
    }
    if (!scheduledAt || Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 10 * 60_000) {
      return json({ error: "Escolha um horário pelo menos 10 minutos no futuro." }, 400);
    }

    const account = await getSocialAccount(env, session.userId, "instagram", accountId);
    if (!account) return json({ error: "Conecte ou selecione sua conta profissional do Instagram antes de agendar." }, 400);
    if (!account.access_token || !account.user_id) {
      return json({ error: "A conexão do Instagram expirou. Reconecte a conta antes de agendar." }, 401);
    }

    const videoId = videoKey.split("/").pop();
    const mediaMetadataKey = userKey(session.userId, "instagram-drive:" + videoId);
    const mediaRaw = await env.POSTFLOW3_KV.get(mediaMetadataKey);
    if (!mediaRaw) return json({ error: "O vídeo não está mais disponível no armazenamento. Envie-o novamente." }, 404);
    const mediaMetadata = JSON.parse(mediaRaw);
    if (String(mediaMetadata.fileId || "") !== driveFileId) {
      return json({ error: "O arquivo do Drive não corresponde ao vídeo selecionado. Envie-o novamente." }, 409);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const post = {
      id,
      title,
      description,
      filename,
      size,
      driveFileId,
      driveCleanupPending: true,
      platforms: ["Instagram"],
      publicationMode: "scheduled",
      scheduledAt: date.toISOString(),
      status: "scheduled",
      instagramStatus: "queued",
      instagramAccountId: accountId || null,
      instagramVideoKey: videoKey,
      instagramMediaId: null,
      instagramCreationId: null,
      createdAt: now,
      uploadedAt: now
    };
    await env.POSTFLOW3_KV.put(userKey(session.userId, "post:" + id), JSON.stringify(post));
    return json({
      scheduled: true,
      post: { id, title, platforms: post.platforms, scheduledAt: post.scheduledAt, status: post.status },
      message: "Agendamento independente do Instagram salvo. A nuvem fará a publicação mesmo com seu computador desligado."
    }, 201);
  } catch (error) {
    return json({ error: String(error?.message || "Não foi possível agendar a publicação no Instagram.").slice(0, 300) }, 500);
  }
}

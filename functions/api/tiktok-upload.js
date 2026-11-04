import { getSession } from "../_lib/security.js";
import { getSocialAccount, saveSocialAccount } from "../_lib/social-accounts.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const MiB = 1024 * 1024;

async function validAccessToken(env, userId, accountId) {
  let token = await getSocialAccount(env, userId, "tiktok", accountId);
  if (!token?.access_token) throw new Error("Reconecte sua conta TikTok no PostFlow3.");
  const expiry = Number(token.access_token_expires_at || 0);
  if (expiry > Date.now() + 90_000) return token;

  if (!token.refresh_token || !env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    throw new Error("A autorização do TikTok expirou. Reconecte a conta TikTok.");
  }
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-store" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token
    })
  });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) {
    console.error("PostFlow3 TikTok token refresh failed", {
      status: response.status,
      error: String(refreshed.error || refreshed.error_description || "refresh_failed").slice(0, 120)
    });
    throw new Error("Não foi possível renovar a autorização do TikTok. Reconecte a conta.");
  }
  token = {
    ...token,
    ...refreshed,
    open_id: String(refreshed.open_id || token.open_id || accountId),
    username: token.username || token.display_name || "TikTok",
    access_token_expires_at: Date.now() + Number(refreshed.expires_in || 86400) * 1000,
    refresh_token_expires_at: Date.now() + Number(refreshed.refresh_expires_in || 31536000) * 1000,
    saved_at: Date.now()
  };
  await saveSocialAccount(env, userId, "tiktok", accountId, token.username, token);
  return token;
}

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Entre no PostFlow3 para enviar ao TikTok." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "O armazenamento de contas não está configurado no Preview." }, 503);

  try {
    const form = await request.formData();
    const file = form.get("video");
    const accountId = String(form.get("accountId") || "").trim();
    if (!file || typeof file.arrayBuffer !== "function" || !accountId) {
      return json({ error: "Selecione um vídeo e uma conta TikTok conectada." }, 400);
    }
    if (!String(file.type || "").startsWith("video/")) {
      return json({ error: "O TikTok aceita somente vídeo nesta integração." }, 415);
    }
    if (file.size < 1 || file.size > 80 * MiB) {
      return json({ error: "O vídeo precisa ter entre 1 byte e 80 MB nesta versão." }, 413);
    }

    const token = await validAccessToken(env, session.userId, accountId);
    const scopes = String(token.scope || "").split(/[ ,]+/).filter(Boolean);
    if (scopes.length && !scopes.includes("video.upload")) {
      return json({ error: "A conta TikTok não autorizou video.upload. Desconecte e conecte novamente depois de habilitar essa permissão no TikTok for Developers." }, 403);
    }

    const chunkSize = file.size < 5 * MiB ? file.size : Math.min(64 * MiB, file.size);
    const totalChunks = Math.ceil(file.size / chunkSize);
    const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token.access_token,
        "Content-Type": "application/json; charset=UTF-8"
      },
      body: JSON.stringify({
        source_info: {
          source: "FILE_UPLOAD",
          video_size: file.size,
          chunk_size: chunkSize,
          total_chunk_count: totalChunks
        }
      })
    });
    const initData = await initResponse.json().catch(() => ({}));
    const uploadUrl = initData.data?.upload_url;
    const publishId = initData.data?.publish_id;
    if (!initResponse.ok || initData.error?.code !== "ok" || !uploadUrl || !publishId) {
      const code = String(initData.error?.code || "upload_init_failed").slice(0, 100);
      const message = String(initData.error?.message || "O TikTok recusou a preparação do envio.").replace(/[\r\n<>]/g, " ").slice(0, 220);
      console.error("PostFlow3 TikTok inbox init failed", { status: initResponse.status, code, log_id: initData.error?.log_id || null });
      return json({ error: "TikTok: " + message + " (" + code + ")." }, 502);
    }

    for (let index = 0; index < totalChunks; index++) {
      const start = index * chunkSize;
      const endExclusive = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, endExclusive);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "video/mp4",
          "Content-Length": String(endExclusive - start),
          "Content-Range": "bytes " + start + "-" + (endExclusive - 1) + "/" + file.size
        },
        body: await chunk.arrayBuffer()
      });
      if (!uploadResponse.ok) {
        const detail = (await uploadResponse.text().catch(() => "")).replace(/[\r\n<>]/g, " ").slice(0, 160);
        console.error("PostFlow3 TikTok chunk upload failed", { status: uploadResponse.status, chunk: index + 1, total: totalChunks });
        return json({ error: "O TikTok não confirmou o envio do bloco " + (index + 1) + " de " + totalChunks + (detail ? ": " + detail : ".") }, 502);
      }
    }

    return json({
      uploadedToInbox: true,
      publishId,
      requiresTikTokConfirmation: true,
      message: "Vídeo enviado para a caixa de entrada do TikTok. Abra a notificação no aplicativo para revisar e concluir a publicação."
    });
  } catch (error) {
    console.error("PostFlow3 TikTok inbox upload failed", {
      name: error?.name || "Error",
      message: String(error?.message || "unknown").replace(/[\r\n<>]/g, " ").slice(0, 180)
    });
    return json({ error: error?.message || "Não foi possível enviar o vídeo ao TikTok." }, 500);
  }
}

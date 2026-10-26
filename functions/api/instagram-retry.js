import { getSession, userKey } from "../_lib/security.js";
import { publishInstagramStep } from "./scheduled-runner.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Faça login novamente." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento de publicações não configurado." }, 503);

  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Identificador da publicação inválido." }, 400);

    const key = userKey(session.userId, "post:" + id);
    const post = await env.POSTFLOW3_KV.get(key, "json");
    if (!post) return json({ error: "Publicação não encontrada." }, 404);
    if (!post.instagramVideoKey || !(Array.isArray(post.platforms) ? post.platforms.includes("Instagram") : true)) {
      return json({ error: "Esta publicação não tem um vídeo selecionado para o Instagram." }, 409);
    }
    if (post.instagramStatus === "published" || post.instagramMediaId) {
      return json({ error: "O Instagram já confirmou esta publicação. Não vou enviá-la novamente." }, 409);
    }

    post.instagramError = null;
    post.instagramStatus = post.instagramCreationId ? "processing" : "pending";
    post.instagramAttemptedAt = new Date().toISOString();
    await env.POSTFLOW3_KV.put(key, JSON.stringify(post));

    try {
      const state = await publishInstagramStep({ request, env, userId: session.userId, post });
      if (state === "failed") {
        post.status = "failed";
      } else if (state === "processing") {
        // Clear the stale global failure while Instagram is processing; the cloud runner
        // will keep polling this same creation ID and will not create a duplicate container.
        post.status = "scheduled";
        post.instagramAttemptedAt = new Date().toISOString();
      } else if (state === "published") {
        post.instagramError = null;
        post.status = (post.youtubeVideoId && post.youtubeStatus !== "published") ? "partially_published" : "published";
        post.publishedAt = post.publishedAt || new Date().toISOString();
      }
      await env.POSTFLOW3_KV.put(key, JSON.stringify(post));
      return json({ ok: state !== "failed", status: state, post, message: state === "published" ? "Instagram publicou o vídeo." : state === "processing" ? "O Instagram está processando o vídeo; o agendador continuará verificando." : (post.instagramError || "O Instagram não publicou o vídeo.") }, state === "failed" ? 502 : 200);
    } catch (error) {
      post.instagramStatus = "failed";
      post.instagramError = String(error?.message || "Falha ao tentar publicar no Instagram.").slice(0, 250);
      post.status = "failed";
      await env.POSTFLOW3_KV.put(key, JSON.stringify(post));
      return json({ error: post.instagramError, post }, 502);
    }
  } catch (error) {
    return json({ error: String(error?.message || "Não foi possível tentar publicar no Instagram.").slice(0, 250) }, 500);
  }
}

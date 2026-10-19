import { hasSession } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const safe = (v, max) => String(v || "").trim().slice(0, max);

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env))) return json({ error: "Faça login novamente." }, 401);
  if (!env.POSTFLOW3_KV) return json({ error: "Armazenamento KV não configurado." }, 503);
  try {
    const list = await env.POSTFLOW3_KV.list({ prefix: "post:", limit: 100 });
    const posts = [];
    for (const key of list.keys) {
      const value = await env.POSTFLOW3_KV.get(key.name, "json");
      if (value) posts.push(value);
    }
    posts.sort((a,b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""));
    return json({ posts });
  } catch { return json({ error: "Não foi possível carregar a fila." }, 500); }
}

export async function onRequestPost({ request, env }) {
  if (!(await hasSession(request, env))) return json({ error: "Faça login novamente." }, 401);
  if (!env.POSTFLOW3_KV || !env.POSTFLOW3_MEDIA) return json({ error: "Armazenamento de fila ou vídeos não está configurado." }, 503);
  try {
    const form = await request.formData();
    const file = form.get("video");
    const title = safe(form.get("title"), 100);
    const description = safe(form.get("description"), 5000);
    const scheduledAt = safe(form.get("scheduledAt"), 40);
    if (!(file instanceof File) || !file.size) return json({ error: "Selecione um arquivo de vídeo." }, 400);
    if (file.size > 80 * 1024 * 1024) return json({ error: "O vídeo precisa ter até 80 MB nesta versão." }, 413);
    if (!/^video\/(mp4|quicktime|webm)$/.test(file.type)) return json({ error: "Formato não aceito. Use MP4, MOV ou WebM." }, 400);
    if (!title) return json({ error: "Digite um título." }, 400);
    const date = new Date(scheduledAt);
    if (!scheduledAt || Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 60_000) return json({ error: "Escolha uma data e horário pelo menos 1 minuto no futuro." }, 400);
    const id = crypto.randomUUID();
    const key = "videos/" + id;
    await env.POSTFLOW3_MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    const post = { id, title, description, filename: safe(file.name, 200), mimeType: file.type, size: file.size, videoKey: key, scheduledAt: date.toISOString(), status: "scheduled", createdAt: new Date().toISOString(), platforms: ["YouTube"] };
    await env.POSTFLOW3_KV.put("post:" + id, JSON.stringify(post));
    return json({ post }, 201);
  } catch { return json({ error: "Não foi possível salvar o vídeo. Tente um arquivo menor." }, 500); }
}

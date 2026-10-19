import { hasSession } from "../_lib/security.js";

export async function onRequestGet({ request, env }) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!(await hasSession(request, env))) return new Response(JSON.stringify({ error: "Não autenticado." }), { status: 401, headers });
  if (!env.POSTFLOW3_KV) return new Response(JSON.stringify({ error: "Armazenamento não configurado." }), { status: 503, headers });
  try {
    const tokens = await env.POSTFLOW3_KV.get("youtube-owner");
    return new Response(JSON.stringify({ connected: Boolean(tokens) }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Não foi possível verificar a conexão." }), { status: 500, headers });
  }
}

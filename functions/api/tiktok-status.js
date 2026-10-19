import { hasSession, decryptJson } from "../_lib/security.js";

export async function onRequestGet({ request, env }) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!(await hasSession(request, env))) return new Response(JSON.stringify({ error: "Não autenticado." }), { status: 401, headers });
  if (!env.POSTFLOW3_KV) return new Response(JSON.stringify({ connected: false, error: "Armazenamento não configurado." }), { status: 503, headers });
  try {
    const raw = await env.POSTFLOW3_KV.get("tiktok-owner");
    if (!raw) return new Response(JSON.stringify({ connected: false }), { status: 200, headers });
    const data = await decryptJson(env, raw);
    return new Response(JSON.stringify({
      connected: Boolean(data.access_token && data.open_id),
      username: data.display_name || "",
      scopes: data.scope || ""
    }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ connected: false, error: "Não foi possível verificar a conexão." }), { status: 500, headers });
  }
}

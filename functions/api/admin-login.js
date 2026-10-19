import { makeSessionCookie, sha256 } from "../_lib/security.js";

export async function onRequestPost({ request, env }) {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  try {
    if (!env.POSTFLOW3_KV) return new Response(JSON.stringify({ error: "O armazenamento do Cloudflare ainda não foi configurado." }), { status: 503, headers });
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = `login-attempts:${await sha256(ip)}`;
    const now = Date.now();
    const current = await env.POSTFLOW3_KV.get(key, "json").catch(() => null);
    const attempts = current && now - current.startedAt < 15 * 60 * 1000 ? current : { count: 0, startedAt: now };
    if (attempts.count >= 5) return new Response(JSON.stringify({ error: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." }), { status: 429, headers });
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const supplied = body.password;
    const expected = env.POSTFLOW3_ADMIN_PASSWORD;
    if (typeof supplied !== "string" || supplied.length > 500 || !expected) {
      return new Response(JSON.stringify({ error: expected ? "Informe a senha de administrador." : "Configure POSTFLOW3_ADMIN_PASSWORD no Cloudflare Pages." }), { status: expected ? 400 : 503, headers });
    }
    if (supplied !== expected) {
      attempts.count += 1;
      await env.POSTFLOW3_KV.put(key, JSON.stringify(attempts), { expirationTtl: 900 });
      return new Response(JSON.stringify({ error: "Senha incorreta." }), { status: 401, headers });
    }
    await env.POSTFLOW3_KV.delete(key).catch(() => {});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...headers, "Set-Cookie": await makeSessionCookie(env) } });
  } catch {
    return new Response(JSON.stringify({ error: "Erro de configuração do login. Confira os secrets do Cloudflare Pages." }), { status: 500, headers });
  }
}
export async function onRequest({ request }) {
  return new Response(JSON.stringify({ error: "Método não permitido." }), { status: 405, headers: { "Allow": "POST", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

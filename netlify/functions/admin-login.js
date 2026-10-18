const { getStore } = require("@netlify/blobs");
const { secret, makeSessionCookie } = require("./_lib/security");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido." }) };
  try {
    const store = getStore({ name: "postflow3-login-limits", consistency: "strong" });
    const ip = event.headers?.["x-nf-client-connection-ip"] || event.headers?.["client-ip"] || "unknown";
    const key = `attempts:${require("node:crypto").createHash("sha256").update(ip).digest("hex")}`;
    const now = Date.now();
    const current = await store.get(key, { type: "json" }).catch(() => null);
    const attempts = current && now - current.startedAt < 15 * 60 * 1000 ? current : { count: 0, startedAt: now };
    if (attempts.count >= 5) return { statusCode: 429, headers, body: JSON.stringify({ error: "Muitas tentativas. Aguarde 15 minutos antes de tentar novamente." }) };

    const expected = secret("POSTFLOW3_ADMIN_PASSWORD");
    const supplied = JSON.parse(event.body || "{}").password;
    if (typeof supplied !== "string" || supplied.length > 500) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Informe a senha de administrador." }) };
    }
    const crypto = require("node:crypto");
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      attempts.count += 1;
      await store.set(key, JSON.stringify(attempts), { expirationTtl: 900 });
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Senha incorreta." }) };
    }
    await store.delete(key).catch(() => {});
    return { statusCode: 200, headers: { ...headers, "Set-Cookie": makeSessionCookie() }, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || "Erro de configuração." }) };
  }
};
const { secret, makeSessionCookie } = require("./_lib/security");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Método não permitido." }) };
  try {
    const expected = secret("POSTFLOW3_ADMIN_PASSWORD");
    const supplied = JSON.parse(event.body || "{}").password;
    if (typeof supplied !== "string" || supplied.length > 500) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Informe a senha de administrador." }) };
    }
    const crypto = require("node:crypto");
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: "Senha incorreta." }) };
    }
    return { statusCode: 200, headers: { ...headers, "Set-Cookie": makeSessionCookie() }, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || "Erro de configuração." }) };
  }
};
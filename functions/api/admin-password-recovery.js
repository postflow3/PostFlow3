import { hashPassword } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
  },
});

const ADMIN_EMAIL = "sergiouai3@gmail.com";

export async function onRequestPost({ request, env }) {
  if (!env.POSTFLOW3_DB || !env.POSTFLOW3_SESSION_SECRET) {
    return json({ error: "A autenticação ainda não está configurada neste ambiente." }, 503);
  }
  if (!env.POSTFLOW3_ADMIN_PASSWORD || env.POSTFLOW3_ADMIN_PASSWORD.length < 24) {
    return json({ error: "Configure uma chave administrativa temporária forte no ambiente Preview antes de recuperar a senha." }, 503);
  }

  // Prevent cross-origin browser requests. This endpoint is intended only for the same-origin Preview site.
  const origin = request.headers.get("Origin");
  const requestUrl = new URL(request.url);
  if (!origin || origin !== requestUrl.origin) {
    return json({ error: "Origem da solicitação não permitida." }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Dados inválidos." }, 400);
  }

  const email = String(body.email || "").trim().toLowerCase();
  const recoveryKey = typeof body.recoveryKey === "string" ? body.recoveryKey : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";

  if (email !== ADMIN_EMAIL) return json({ error: "Recuperação não autorizada." }, 403);
  if (recoveryKey.length !== env.POSTFLOW3_ADMIN_PASSWORD.length || recoveryKey !== env.POSTFLOW3_ADMIN_PASSWORD) {
    return json({ error: "Chave de recuperação inválida." }, 403);
  }
  if (newPassword.length < 10 || newPassword.length > 128) {
    return json({ error: "A nova senha deve ter entre 10 e 128 caracteres." }, 400);
  }
  if (newPassword === recoveryKey) {
    return json({ error: "Escolha uma senha de login diferente da chave de recuperação." }, 400);
  }

  try {
    const user = await env.POSTFLOW3_DB.prepare(
      "SELECT id FROM users WHERE email = ? COLLATE NOCASE AND role = 'admin' AND status = 'active' LIMIT 1"
    ).bind(ADMIN_EMAIL).first();

    // Never create, reactivate, or change the role of an account through password recovery.
    if (!user) return json({ error: "Conta administrativa ativa não encontrada." }, 404);

    const passwordHash = await hashPassword(newPassword);
    const result = await env.POSTFLOW3_DB.prepare(
      "UPDATE users SET password_hash = ? WHERE id = ? AND email = ? COLLATE NOCASE AND role = 'admin' AND status = 'active'"
    ).bind(passwordHash, user.id, ADMIN_EMAIL).run();

    if (!Number(result?.meta?.changes || 0)) {
      return json({ error: "A senha não foi alterada. Tente novamente." }, 409);
    }

    return json({ ok: true, message: "Senha administrativa redefinida. Entre usando a nova senha." });
  } catch {
    return json({ error: "Não foi possível concluir a recuperação neste momento." }, 500);
  }
}

export async function onRequest({ request }) {
  if (request.method === "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  return json({ error: "Método não permitido." }, 405);
}

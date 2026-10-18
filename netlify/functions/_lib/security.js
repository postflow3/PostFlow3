const crypto = require("node:crypto");

function secret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Configure ${name} nas variáveis de ambiente da Netlify.`);
  return value;
}

function sign(value) {
  return crypto.createHmac("sha256", secret("POSTFLOW3_SESSION_SECRET")).update(value).digest("base64url");
}

function makeSessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString("base64url");
  const value = `${payload}.${sign(payload)}`;
  return `pf3_session=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
}

function hasSession(event) {
  try {
    const header = event.headers?.cookie || event.headers?.Cookie || "";
    const raw = header.split(";").map(s => s.trim()).find(s => s.startsWith("pf3_session="))?.slice("pf3_session=".length);
    if (!raw) return false;
    const [payload, signature] = raw.split(".");
    if (!payload || !signature) return false;
    const expected = sign(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data.exp) > Date.now();
  } catch {
    return false;
  }
}

function makeStateCookie(state) {
  const signature = sign(`oauth:${state}`);
  return `pf3_oauth_state=${state}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/.netlify/functions; Max-Age=600`;
}

function verifyStateCookie(event, state) {
  try {
    const header = event.headers?.cookie || event.headers?.Cookie || "";
    const raw = header.split(";").map(s => s.trim()).find(s => s.startsWith("pf3_oauth_state="))?.slice("pf3_oauth_state=".length);
    if (!raw || !state) return false;
    const [cookieState, signature] = raw.split(".");
    if (cookieState !== state || !signature) return false;
    const expected = sign(`oauth:${state}`);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function encryptJson(value) {
  const key = Buffer.from(secret("TOKEN_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY precisa ser uma chave Base64 de 32 bytes.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: encrypted.toString("base64") });
}

module.exports = { secret, makeSessionCookie, hasSession, makeStateCookie, verifyStateCookie, encryptJson };
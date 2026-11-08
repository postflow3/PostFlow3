const enc = new TextEncoder();
const dec = new TextDecoder();

function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Configure a variável ${name} nas configurações do Cloudflare Pages.`);
  return value;
}
function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
function base64url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(value) {
  const normal = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(normal + "=".repeat((4 - normal.length % 4) % 4));
}
async function hmac(env, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(required(env, "POSTFLOW3_SESSION_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value))));
}
async function encryptionKeyBytes(env) {
  const configured = env.TOKEN_ENCRYPTION_KEY;
  if (configured) {
    try {
      const bytes = base64ToBytes(configured.trim());
      if (bytes.length === 32) return bytes;
    } catch {}
  }
  // Stable fallback for deployments where TOKEN_ENCRYPTION_KEY was missing or malformed.
  // The existing session secret is required by the login/session system and is never returned to the client.
  const material = required(env, "POSTFLOW3_SESSION_SECRET") + ":postflow3-token-encryption-v1";
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(material)));
}
export async function makeSessionCookie(env, user) {
  if (!user || !user.id) throw new Error("Usuário inválido para criar sessão.");
  const payload = base64url(enc.encode(JSON.stringify({ uid: user.id, exp: Date.now() + 12 * 60 * 60 * 1000 })));
  return `pf3_session=${payload}.${await hmac(env, payload)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
}
export async function getSession(request, env) {
  try {
    const raw = (request.headers.get("Cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("pf3_session="))?.slice("pf3_session=".length);
    if (!raw) return null;
    const [payload, signature] = raw.split(".");
    if (!payload || !signature) return null;
    const expected = await hmac(env, payload);
    if (signature.length !== expected.length) return null;
    const a = enc.encode(signature), b = enc.encode(expected);
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return null;
    const data = JSON.parse(dec.decode(fromBase64url(payload)));
    if (!data.uid || Number(data.exp) <= Date.now()) return null;
    return { userId: String(data.uid) };
  } catch { return null; }
}
export async function hasSession(request, env) {
  return Boolean(await getSession(request, env));
}
export async function makeOAuthState(env, userId) {
  const nonce = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${nonce}.${await hmac(env, `oauth:${nonce}:${userId}`)}`;
}
export async function verifyStateCookie(request, env, state, userId) {
  try {
    if (!state || !userId) return false;
    const parts = state.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    const [nonce, signature] = parts;
    const expected = await hmac(env, `oauth:${nonce}:${userId}`);
    if (signature.length !== expected.length) return false;
    const a = enc.encode(signature), b = enc.encode(expected);
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}
export async function decryptJson(env, value) {
  const keyBytes = await encryptionKeyBytes(env);
  const item = typeof value === "string" ? JSON.parse(value) : value;
  if (!item || item.v !== 1 || !item.iv || !item.data) throw new Error("Formato de token criptografado inválido.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(item.iv) }, key, base64ToBytes(item.data));
  return JSON.parse(dec.decode(plain));
}
export async function encryptJson(env, value) {
  const keyBytes = await encryptionKeyBytes(env);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), data: bytesToBase64(ciphertext) });
}
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256.100000.${bytesToBase64(salt)}.${bytesToBase64(new Uint8Array(bits))}`;
}
export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterationsText, saltText, hashText] = String(stored).split(".");
    const iterations = Number(iterationsText);
    if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 100000 || iterations > 500000 || !saltText || !hashText) return false;
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: base64ToBytes(saltText), iterations, hash: "SHA-256" }, key, 256));
    const actual = bytesToBase64(bits);
    if (actual.length !== hashText.length) return false;
    const a = enc.encode(actual), b = enc.encode(hashText);
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}
export function userKey(userId, key) {
  if (!/^[0-9a-f-]{36}$/i.test(String(userId))) throw new Error("Sessão de usuário inválida.");
  return `user:${userId}:${key}`;
}

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
export async function makeSessionCookie(env) {
  const payload = base64url(enc.encode(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })));
  return `pf3_session=${payload}.${await hmac(env, payload)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
}
export async function hasSession(request, env) {
  try {
    const raw = (request.headers.get("Cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("pf3_session="))?.slice("pf3_session=".length);
    if (!raw) return false;
    const [payload, signature] = raw.split(".");
    if (!payload || !signature) return false;
    const expected = await hmac(env, payload);
    if (signature.length !== expected.length) return false;
    const a = enc.encode(signature), b = enc.encode(expected);
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff !== 0) return false;
    return Number(JSON.parse(dec.decode(fromBase64url(payload))).exp) > Date.now();
  } catch { return false; }
}
export async function makeStateCookie(env, state) {
  return `pf3_oauth_state=${state}.${await hmac(env, `oauth:${state}`)}; HttpOnly; Secure; SameSite=Lax; Path=/api; Max-Age=600`;
}
export async function verifyStateCookie(request, env, state) {
  try {
    const raw = (request.headers.get("Cookie") || "").split(";").map(s => s.trim()).find(s => s.startsWith("pf3_oauth_state="))?.slice("pf3_oauth_state=".length);
    if (!raw || !state) return false;
    const [cookieState, signature] = raw.split(".");
    if (cookieState !== state || !signature) return false;
    const expected = await hmac(env, `oauth:${state}`);
    if (signature.length !== expected.length) return false;
    const a = enc.encode(signature), b = enc.encode(expected);
    let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch { return false; }
}
export async function decryptJson(env, value) {
  const keyBytes = base64ToBytes(required(env, "TOKEN_ENCRYPTION_KEY"));
  if (keyBytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY precisa ser uma chave Base64 de 32 bytes.");
  const item = typeof value === "string" ? JSON.parse(value) : value;
  if (!item || item.v !== 1 || !item.iv || !item.data) throw new Error("Formato de token criptografado inválido.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(item.iv) }, key, base64ToBytes(item.data));
  return JSON.parse(dec.decode(plain));
}
export async function encryptJson(env, value) {
  const keyBytes = base64ToBytes(required(env, "TOKEN_ENCRYPTION_KEY"));
  if (keyBytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY precisa ser uma chave Base64 de 32 bytes.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(value))));
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), data: bytesToBase64(ciphertext) });
}
export async function sha256(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)))].map(b => b.toString(16).padStart(2, "0")).join("");
}

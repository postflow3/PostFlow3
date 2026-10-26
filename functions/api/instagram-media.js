import { decryptJson, encryptJson, userKey } from "../_lib/security.js";

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

async function signature(env, key) {
  const secret = env.POSTFLOW3_SESSION_SECRET;
  if (!secret) return "";
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode("instagram-media:" + key))
  );
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function googleToken(env, userId) {
  if (!env.POSTFLOW3_KV || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google Drive authorization is not configured");
  }

  const key = userKey(userId, "youtube-owner");
  const raw = await env.POSTFLOW3_KV.get(key);
  if (!raw) throw new Error("Google account is not connected");

  let token = await decryptJson(env, raw);
  const expiresAt = Number(token.expiry_date || ((token.saved_at || 0) + Number(token.expires_in || 0) * 1000));
  if (token.access_token && expiresAt > Date.now() + 60000) return token.access_token;
  if (!token.refresh_token) throw new Error("Google authorization expired; reconnect Google");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token"
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error("Google token refresh failed");

  token = {
    ...token,
    ...data,
    refresh_token: token.refresh_token,
    expiry_date: Date.now() + Number(data.expires_in || 3600) * 1000,
    saved_at: Date.now()
  };
  await env.POSTFLOW3_KV.put(key, await encryptJson(env, token));
  return token.access_token;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const key = url.searchParams.get("key") || "";
    const suppliedSignature = url.searchParams.get("sig") || "";
    const match = key.match(/^instagram-media\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);

    if (!match || !suppliedSignature || !env.POSTFLOW3_KV) return notFound();
    const expectedSignature = await signature(env, key);
    if (!expectedSignature || suppliedSignature.length !== expectedSignature.length || suppliedSignature !== expectedSignature) {
      return notFound();
    }

    const [, userId, id] = match;
    const raw = await env.POSTFLOW3_KV.get(userKey(userId, "instagram-drive:" + id));
    if (!raw) return notFound();

    const metadata = JSON.parse(raw);
    if (!metadata.fileId) return notFound();

    const accessToken = await googleToken(env, userId);
    const upstreamHeaders = new Headers({ Authorization: "Bearer " + accessToken });
    // Meta may request byte ranges while validating or downloading a Reel.
    const range = request.headers.get("Range");
    if (range && /^bytes=\d*-\d*(,\d*-\d*)*$/.test(range)) upstreamHeaders.set("Range", range);

    const upstream = await fetch(
      "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(metadata.fileId) + "?alt=media",
      { headers: upstreamHeaders }
    );
    if ((!upstream.ok && upstream.status !== 206) || !upstream.body) return notFound();

    const responseHeaders = new Headers({
      "Content-Type": metadata.mimeType || upstream.headers.get("Content-Type") || "video/mp4",
      "Cache-Control": "public, max-age=300",
      "Accept-Ranges": upstream.headers.get("Accept-Ranges") || "bytes",
      "X-Content-Type-Options": "nosniff"
    });
    const contentLength = upstream.headers.get("Content-Length") || (!range ? String(metadata.size || "") : "");
    const contentRange = upstream.headers.get("Content-Range");
    if (contentLength) responseHeaders.set("Content-Length", contentLength);
    if (contentRange) responseHeaders.set("Content-Range", contentRange);

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    // Do not leak Google tokens, Drive IDs, or internal exception details through this public signed URL.
    return notFound();
  }
}

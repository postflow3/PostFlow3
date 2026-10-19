import { hasSession, makeStateCookie } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
});

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env))) return json({ error: "Entre no PostFlow3 antes de conectar o TikTok." }, 401);
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    return json({ error: "Configure TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET nos secrets do Cloudflare Pages e cadastre /api/tiktok-callback no Login Kit do TikTok." }, 503);
  }
  const redirectUri = env.TIKTOK_REDIRECT_URI || new URL("/api/tiktok-callback", request.url).toString();
  const state = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: env.TIKTOK_SCOPES || "user.info.basic,video.publish",
    state
  });
  return new Response(null, { status: 302, headers: {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Location": `https://www.tiktok.com/v2/auth/authorize/?${params}`,
    "Set-Cookie": await makeStateCookie(env, state)
  }});
}

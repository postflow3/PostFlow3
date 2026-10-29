import { getSession, makeOAuthState } from "../_lib/security.js";

const DEFAULT_REDIRECT_URI = "https://cloudflare-migration.postflow3.pages.dev/api/tiktok-callback";
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
});

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Entre no PostFlow3 antes de conectar o TikTok." }, 401);
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
    return json({ error: "A integração precisa dos secrets TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET no Cloudflare Pages Preview." }, 503);
  }
  const redirectUri = env.TIKTOK_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const state = await makeOAuthState(env, session.userId);
  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    // Request only scopes currently enabled in the Sandbox app.
    // video.publish must be added and approved in TikTok for Developers before requesting direct-post access.
    scope: "user.info.basic,video.upload",
    response_type: "code",
    redirect_uri: redirectUri,
    state
  });
  return new Response(null, { status: 302, headers: {
    "Location": "https://www.tiktok.com/v2/auth/authorize/?" + params.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  }});
}

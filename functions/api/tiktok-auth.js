import { hasSession, makeStateCookie } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }
});

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env))) return json({ error: "Entre no PostFlow3 antes de conectar o TikTok." }, 401);
  // Preview can use the separately stored Sandbox credentials; Production remains on its own branch.
  const clientKey = env.TIKTOK_CLIENT_KEY1 || env.TIKTOK_CLIENT_KEY;
  if (!clientKey || !(env.TIKTOK_CLIENT_SECRET1 || env.TIKTOK_CLIENT_SECRET)) {
    return json({ error: "Configure as credenciais do TikTok no ambiente Preview do Cloudflare Pages e cadastre /api/tiktok-callback no Login Kit do TikTok." }, 503);
  }
  // Preview OAuth must use the same stable callback URI registered in TikTok Developers.
  const redirectUri = "https://cloudflare-migration.postflow3.pages.dev/api/tiktok-callback";
  const state = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
  const params = new URLSearchParams({
    client_key: clientKey,
    redirect_uri: redirectUri,
    response_type: "code",
    // Current TikTok app configuration includes video.upload (draft upload), not video.publish (direct post).
    scope: env.TIKTOK_SCOPES || "user.info.basic,video.upload",
    state
  });
  return new Response(null, { status: 302, headers: {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Location": `https://www.tiktok.com/v2/auth/authorize/?${params}`,
    "Set-Cookie": await makeStateCookie(env, state)
  }});
}

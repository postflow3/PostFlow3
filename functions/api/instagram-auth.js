import { getSession, makeOAuthState } from "../_lib/security.js";

const DEFAULT_REDIRECT_URI = "https://cloudflare-migration.postflow3.pages.dev/api/instagram-callback";

export async function onRequestGet({ request, env }) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const session = await getSession(request, env);
  if (!session) return new Response(JSON.stringify({ error: "Entre no PostFlow3 antes de conectar o Instagram." }), { status: 401, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) return new Response(JSON.stringify({ error: "Configure INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET nas variáveis do Cloudflare Pages." }), { status: 503, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

  const redirectUri = env.INSTAGRAM_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const state = await makeOAuthState(env, session.userId);
  const params = new URLSearchParams({
    force_reauth: "true",
    client_id: env.INSTAGRAM_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish",
    state
  });
  return new Response(null, { status: 302, headers: { ...headers, "Location": `https://www.instagram.com/oauth/authorize?${params}` } });
}

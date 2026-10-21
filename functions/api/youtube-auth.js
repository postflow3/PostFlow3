import { getSession, makeOAuthState } from "../_lib/security.js";

export async function onRequestGet({ request, env }) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const session = await getSession(request, env);
  if (!session) return new Response(JSON.stringify({ error: "Faça login no PostFlow3 antes de conectar suas contas Google." }), { status: 401, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId || !env.GOOGLE_CLIENT_SECRET) return new Response(JSON.stringify({ error: "Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nos secrets do Cloudflare Pages." }), { status: 503, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  const redirectUri = env.GOOGLE_REDIRECT_URI || "https://cloudflare-migration.postflow3.pages.dev/api/youtube-callback";
  const state = await makeOAuthState(env, session.userId);
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/drive",
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state
  });
  return new Response(null, { status: 302, headers: { ...headers, "Location": `https://accounts.google.com/o/oauth2/v2/auth?${params}` } });
}

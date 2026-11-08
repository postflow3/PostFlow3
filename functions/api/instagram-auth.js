import { getSession, makeOAuthState } from "../_lib/security.js";

const DEFAULT_APP_ID = "1628313285604238";
const DEFAULT_CONFIG_ID = "1141223928645717";
const GRAPH_VERSION = "v23.0";

export async function onRequestGet({ request, env }) {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  const session = await getSession(request, env);
  if (!session) return new Response(JSON.stringify({ error: "Entre no PostFlow3 antes de conectar o Instagram." }), { status: 401, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });

  const appId = env.INSTAGRAM_APP_ID || DEFAULT_APP_ID;
  const configId = env.INSTAGRAM_CONFIG_ID || DEFAULT_CONFIG_ID;
  if (!appId || !env.INSTAGRAM_APP_SECRET || !configId) {
    return new Response(JSON.stringify({ error: "A configuração do Instagram está incompleta. Confira o App ID, App Secret e Config ID no Cloudflare Pages." }), { status: 503, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
  }

  const redirectUri = env.INSTAGRAM_REDIRECT_URI || new URL(request.url).origin + "/api/instagram-callback";
  const state = await makeOAuthState(env, session.userId);
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
    config_id: configId,
    override_default_response_type: "true",
    state
  });
  return new Response(null, { status: 302, headers: { ...headers, "Location": `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}` } });
}

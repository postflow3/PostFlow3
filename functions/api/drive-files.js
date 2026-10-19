import { hasSession, decryptJson, encryptJson } from "../_lib/security.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

async function getAccessToken(request, env) {
  const encrypted = await env.POSTFLOW3_KV.get("youtube-owner");
  if (!encrypted) throw new Error("Conecte novamente a conta Google no PostFlow3.");
  const tokens = await decryptJson(env, encrypted);
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date > Date.now() + 60_000) return { tokens, accessToken: tokens.access_token };
  if (!tokens.refresh_token) throw new Error("A conexão Google precisa ser renovada. Conecte novamente a conta Google.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token, grant_type: "refresh_token"
    })
  });
  const refreshed = await response.json();
  if (!response.ok || !refreshed.access_token) throw new Error("Não foi possível renovar a autorização Google.");
  const next = { ...tokens, ...refreshed, refresh_token: tokens.refresh_token, expiry_date: Date.now() + Number(refreshed.expires_in || 3600) * 1000, saved_at: Date.now() };
  await env.POSTFLOW3_KV.put("youtube-owner", await encryptJson(env, next));
  return { tokens: next, accessToken: next.access_token };
}

export async function onRequestGet({ request, env }) {
  if (!(await hasSession(request, env))) return json({ error: "Faça login novamente." }, 401);
  if (!env.POSTFLOW3_KV || !env.TOKEN_ENCRYPTION_KEY || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ error: "A configuração Google segura está incompleta." }, 503);
  try {
    const { accessToken } = await getAccessToken(request, env);
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", "mimeType contains 'video/' and trashed = false");
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)");
    url.searchParams.set("spaces", "drive");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json();
    if (!response.ok) return json({ error: data.error?.message || "Não foi possível listar os vídeos do Google Drive." }, response.status === 401 ? 401 : 502);
    return json({ files: (data.files || []).map(file => ({
      id: file.id, name: file.name, mimeType: file.mimeType,
      size: file.size ? Number(file.size) : null,
      modifiedTime: file.modifiedTime, webViewLink: file.webViewLink
    })), nextPageToken: data.nextPageToken || null });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Erro ao consultar o Google Drive." }, 500);
  }
}

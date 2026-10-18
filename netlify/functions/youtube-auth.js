const crypto = require("node:crypto");
const { hasSession, makeStateCookie } = require("../lib/security");

exports.handler = async (event) => {
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!hasSession(event)) {
    return { statusCode: 401, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Faça login no PostFlow3 antes de conectar o YouTube." }) };
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) {
    return { statusCode: 500, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nas variáveis da Netlify." }) };
  }
  const siteUrl = (process.env.URL || "https://earnest-panda-af735b.netlify.app").replace(/\/$/, "");
  const redirectUri = `${siteUrl}/.netlify/functions/youtube-callback`;
  const state = crypto.randomBytes(32).toString("base64url");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent",
    state
  });
  return {
    statusCode: 302,
    headers: { ...headers, Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, "Set-Cookie": makeStateCookie(state) }
  };
};
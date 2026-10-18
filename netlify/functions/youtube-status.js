const { getStore } = require("@netlify/blobs");
const { hasSession } = require("./_lib/security");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (!hasSession(event)) return { statusCode: 401, headers, body: JSON.stringify({ error: "Não autenticado." }) };
  try {
    const store = getStore("postflow3-private-tokens");
    const tokens = await store.get("youtube-owner");
    return { statusCode: 200, headers, body: JSON.stringify({ connected: Boolean(tokens) }) };
  } catch {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Não foi possível verificar a conexão." }) };
  }
};
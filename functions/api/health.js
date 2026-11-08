export async function onRequestGet({ env }) {
  const ready = Boolean(env?.POSTFLOW3_DB && env?.POSTFLOW3_SESSION_SECRET);
  return new Response(JSON.stringify({
    service: "PostFlow3",
    status: ready ? "ready" : "configuration_required",
    authReady: Boolean(env?.POSTFLOW3_SESSION_SECRET),
    databaseReady: Boolean(env?.POSTFLOW3_DB)
  }), {
    status: ready ? 200 : 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

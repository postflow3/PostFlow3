const RUNNER_URL = "https://cloudflare-migration.postflow3.pages.dev/api/scheduled-runner";

async function getStoreValue(env, key) {
  if (env.POSTFLOW3_DB) {
    const row = await env.POSTFLOW3_DB.prepare(
      "SELECT value FROM kv_store WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)"
    ).bind(String(key), Date.now()).first();
    if (row) return row.value;
  }
  return env.POSTFLOW3_KV ? env.POSTFLOW3_KV.get(String(key)) : null;
}

async function putStoreValue(env, key, value, options = {}) {
  if (env.POSTFLOW3_DB) {
    const ttl = Number(options.expirationTtl || 0);
    const expires = ttl > 0 ? Date.now() + ttl * 1000 : null;
    await env.POSTFLOW3_DB.prepare(
      "INSERT OR REPLACE INTO kv_store (key, value, expires_at, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(String(key), String(value), expires, Date.now()).run();
    return;
  }
  if (env.POSTFLOW3_KV) return env.POSTFLOW3_KV.put(String(key), value, options);
  throw new Error("PostFlow3 scheduler has no D1 or legacy KV storage binding.");
}

export default {
  async scheduled(controller, env) {
    const startedAt = new Date().toISOString();
    try {
      if (!env.POSTFLOW3_DB && !env.POSTFLOW3_KV) {
        throw new Error("PostFlow3 scheduler requires the D1 binding or legacy KV binding.");
      }
      const secret = env.POSTFLOW3_SCHEDULER_SECRET || await getStoreValue(env, "system:scheduler-secret");
      if (!secret) throw new Error("PostFlow3 scheduler secret is missing from the secret binding or D1/KV store.");
      const response = await fetch(RUNNER_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledTime: controller.scheduledTime, cron: controller.cron })
      });
      const responseBody = (await response.text()).slice(0, 1800);
      const record = { startedAt, finishedAt: new Date().toISOString(), ok: response.ok, httpStatus: response.status, cron: controller.cron, response: responseBody };
      await putStoreValue(env, "system:scheduler-last-run", JSON.stringify(record), { expirationTtl: 90 * 86400 });
      if (!response.ok) throw new Error("PostFlow3 scheduler returned HTTP " + response.status + ": " + responseBody.slice(0, 500));
    } catch (error) {
      try {
        await putStoreValue(env, "system:scheduler-last-run", JSON.stringify({
          startedAt, finishedAt: new Date().toISOString(), ok: false, cron: controller.cron,
          error: String(error?.message || error).slice(0, 1000)
        }), { expirationTtl: 90 * 86400 });
      } catch (storageError) {
        console.error("PostFlow3 scheduler could not save its failure record", String(storageError?.message || storageError).slice(0, 160));
      }
      throw error;
    }
  },
  async fetch() {
    return new Response("PostFlow3 scheduler is active via Cron Trigger.", { headers: { "Cache-Control": "no-store" } });
  }
};

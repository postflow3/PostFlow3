import { kv } from "../functions/_lib/kv.js";

const RUNNER_URL = "https://cloudflare-migration.postflow3.pages.dev/api/scheduled-runner";
export default {
  async scheduled(controller, env) {
    const startedAt = new Date().toISOString();
    try {
      const store = kv(env);
      if (!store) throw new Error("PostFlow3 scheduler requires the D1 binding or legacy KV binding.");
      const secret = env.POSTFLOW3_SCHEDULER_SECRET || await store.get("system:scheduler-secret");
      if (!secret) throw new Error("PostFlow3 scheduler secret is missing from the scheduler secret or D1/KV store.");
      const response = await fetch(RUNNER_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledTime: controller.scheduledTime, cron: controller.cron })
      });
      const responseBody = (await response.text()).slice(0, 1800);
      const record = { startedAt, finishedAt: new Date().toISOString(), ok: response.ok, httpStatus: response.status, cron: controller.cron, response: responseBody };
      await store.put("system:scheduler-last-run", JSON.stringify(record), { expirationTtl: 90 * 86400 });
      if (!response.ok) throw new Error("PostFlow3 scheduler returned HTTP " + response.status + ": " + responseBody.slice(0, 500));
    } catch (error) {
      await kv(env)?.put("system:scheduler-last-run", JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), ok: false, cron: controller.cron, error: String(error?.message || error).slice(0, 1000) }), { expirationTtl: 90 * 86400 });
      throw error;
    }
  },
  async fetch() {
    return new Response("PostFlow3 scheduler is active via Cron Trigger.", { headers: { "Cache-Control": "no-store" } });
  }
};

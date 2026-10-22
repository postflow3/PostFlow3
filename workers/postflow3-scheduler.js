const RUNNER_URL = "https://cloudflare-migration.postflow3.pages.dev/api/scheduled-runner";
export default {
  async scheduled(controller, env) {
    const startedAt = new Date().toISOString();
    try {
      const secret = await env.POSTFLOW3_KV.get("system:scheduler-secret");
      if (!secret) throw new Error("PostFlow3 scheduler secret is missing from KV.");
      const response = await fetch(RUNNER_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledTime: controller.scheduledTime, cron: controller.cron })
      });
      const responseBody = (await response.text()).slice(0, 1800);
      const record = { startedAt, finishedAt: new Date().toISOString(), ok: response.ok, httpStatus: response.status, cron: controller.cron, response: responseBody };
      await env.POSTFLOW3_KV.put("system:scheduler-last-run", JSON.stringify(record), { expirationTtl: 90 * 86400 });
      if (!response.ok) throw new Error("PostFlow3 scheduler returned HTTP " + response.status + ": " + responseBody.slice(0, 500));
    } catch (error) {
      await env.POSTFLOW3_KV.put("system:scheduler-last-run", JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), ok: false, cron: controller.cron, error: String(error?.message || error).slice(0, 1000) }), { expirationTtl: 90 * 86400 });
      throw error;
    }
  },
  async fetch() {
    return new Response("PostFlow3 scheduler is active via Cron Trigger.", { headers: { "Cache-Control": "no-store" } });
  }
};

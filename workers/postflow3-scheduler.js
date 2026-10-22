const RUNNER_URL = "https://cloudflare-migration.postflow3.pages.dev/api/scheduled-runner";
export default {
  async scheduled(controller, env, ctx) {
    const secret = await env.POSTFLOW3_KV.get("system:scheduler-secret");
    if (!secret) throw new Error("PostFlow3 scheduler secret is missing from KV.");
    const response = await fetch(RUNNER_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
      body: JSON.stringify({ scheduledTime: controller.scheduledTime, cron: controller.cron })
    });
    if (!response.ok) throw new Error("PostFlow3 scheduler returned HTTP " + response.status + ": " + (await response.text()).slice(0, 500));
  },
  async fetch() {
    return new Response("PostFlow3 scheduler is active via Cron Trigger.", { headers: { "Cache-Control": "no-store" } });
  }
};

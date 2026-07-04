const DEFAULT_TIMEOUT_MS = 2500;

function isEnabled() {
  return Boolean((process.env.ALERT_WEBHOOK_URL || "").trim());
}

async function notifyOpsAlert(event, payload = {}) {
  const url = (process.env.ALERT_WEBHOOK_URL || "").trim();
  if (!url) return { sent: false, reason: "disabled" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event,
        service: "englishmind-server",
        timestamp: new Date().toISOString(),
        ...payload,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(JSON.stringify({ event: "alert_webhook_failed", status: res.status }));
      return { sent: false, status: res.status };
    }
    return { sent: true, status: res.status };
  } catch (e) {
    console.error(JSON.stringify({ event: "alert_webhook_failed", message: e.message }));
    return { sent: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isEnabled, notifyOpsAlert };

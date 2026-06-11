#!/usr/bin/env node
/** One-off smoke test against production Railway. No secrets in output. */
const BASE = process.env.RAILWAY_BASE_URL || "https://englishmind-backen-production.up.railway.app";

async function req(method, path, { headers = {}, body } = {}) {
  const url = `${BASE}${path}`;
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const tests = [];

async function run(name, fn) {
  try {
    const result = await fn();
    tests.push({ name, ok: true, ...result });
    console.log(`PASS ${name} → ${result.status}`, typeof result.body === "object" ? JSON.stringify(result.body) : result.body);
  } catch (e) {
    tests.push({ name, ok: false, error: e.message });
    console.log(`FAIL ${name} → ${e.message}`);
  }
}

console.log(`Base: ${BASE}\n`);

await run("GET /healthz", () => req("GET", "/healthz"));
await run("GET /health", () => req("GET", "/health"));
await run("POST /api/ai/generate no token → 401", async () => {
  const r = await req("POST", "/api/ai/generate", {
    body: { taskType: "translate_core", prompt: "hi", systemInstruction: "x", schemaJson: "{}" },
  });
  if (r.status !== 401) throw new Error(`expected 401 got ${r.status}`);
  return r;
});
await run("POST /api/ai/generate fake token → 401", async () => {
  const r = await req("POST", "/api/ai/generate", {
    headers: { Authorization: "Bearer fake-token" },
    body: { taskType: "local_stt", prompt: "hi", systemInstruction: "x", schemaJson: "{}" },
  });
  if (r.status !== 401) throw new Error(`expected 401 got ${r.status}`);
  return r;
});
await run("GET /api/admin/ai-diagnostics no token", () => req("GET", "/api/admin/ai-diagnostics"));

const betaKey = process.env.BETA_OPS_API_SECRET;
if (betaKey) {
  await run("POST /v1/ai/can-use with beta key", async () => {
    const r = await req("POST", "/v1/ai/can-use", {
      headers: { "X-EnglishMind-Beta-Key": betaKey },
      body: { deviceHash: "railway-smoke-test", appVersion: "1.0.2-beta" },
    });
    if (r.status !== 200) throw new Error(`expected 200 got ${r.status}`);
    return r;
  });
} else {
  console.log("SKIP beta can-use (set BETA_OPS_API_SECRET env to test)");
}

const deployedAiSafe = tests.find((t) => t.name.includes("admin"))?.status === 401 || tests.find((t) => t.name.includes("admin"))?.status === 403;
const adminTest = tests.find((t) => t.name.includes("admin"));
console.log("\n--- Summary ---");
console.log(`AI-SAFE deployed: ${adminTest?.status === 404 ? "NO (admin route 404 — redeploy commit 6bbfa58+)" : adminTest?.status === 401 || adminTest?.status === 403 ? "LIKELY YES" : "UNKNOWN"}`);
const failed = tests.filter((t) => !t.ok);
process.exit(failed.length ? 1 : 0);

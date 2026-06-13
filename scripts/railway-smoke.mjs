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

await run("GET /static/voice-packs/voice-pack-v1.zip", async () => {
  const res = await fetch(`${BASE}/static/voice-packs/voice-pack-v1.zip`);
  if (res.status !== 200) throw new Error(`expected 200 got ${res.status}`);
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  if (size < 50) throw new Error(`zip too small: ${size} bytes`);
  return {
    status: res.status,
    body: { sizeBytes: size, contentType: res.headers.get("content-type") },
  };
});

await run("GET /api/voice-pack/signed-url no token → 401", async () => {
  const r = await req("GET", "/api/voice-pack/signed-url?version=v1");
  if (r.status !== 401) throw new Error(`expected 401 got ${r.status}`);
  return r;
});

await run("GET /api/voice-pack/signed-url fake token → 401", async () => {
  const r = await req("GET", "/api/voice-pack/signed-url?version=v1", {
    headers: { Authorization: "Bearer fake-token" },
  });
  if (r.status !== 401) throw new Error(`expected 401 got ${r.status}`);
  return r;
});

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

const adminTest = tests.find((t) => t.name.includes("admin"));
const voiceStatic = tests.find((t) => t.name.includes("voice-pack-v1.zip"));
const failed = tests.filter((t) => !t.ok);
console.log("\n--- Summary ---");
console.log(`Voice pack static: ${voiceStatic?.ok ? `OK (${voiceStatic.body?.sizeBytes ?? "?"} bytes)` : voiceStatic?.error ?? "NOT TESTED"}`);
console.log(`AI-SAFE deployed: ${adminTest?.status === 404 ? "NO (admin route 404 — redeploy commit 6bbfa58+)" : adminTest?.status === 401 || adminTest?.status === 403 ? "LIKELY YES" : "UNKNOWN"}`);
process.exit(failed.length ? 1 : 0);

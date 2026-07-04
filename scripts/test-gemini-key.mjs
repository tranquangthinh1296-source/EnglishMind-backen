// Quick auth-key smoke test — no secrets logged.
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY not set");
  process.exit(1);
}
console.log("key_prefix=", key.slice(0, 4), "len=", key.length);

const body = {
  contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
};

async function tryCall(label, url, headers) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  console.log(`\n[${label}] HTTP ${resp.status}`);
  console.log(text.slice(0, 400));
}

const base =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

await tryCall("query_key", `${base}?key=${encodeURIComponent(key)}`, {});
await tryCall("x-goog-api-key", base, { "x-goog-api-key": key });
await tryCall("bearer", base, { Authorization: `Bearer ${key}` });

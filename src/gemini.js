// Server-side Gemini caller. The API key lives only here (env), never on the
// client — this is the whole point of the Pro AI proxy.
const API_KEY = process.env.GEMINI_API_KEY;
// gemini-2.0-flash no longer has free-tier quota (limit 0) — 2.5-flash-lite does.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

// Calls Gemini generateContent and returns the model's text (expected JSON
// when a schema is supplied). Throws on HTTP / API errors.
async function generate({ prompt, systemInstruction, schemaJson }) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const generationConfig = {};
  if (schemaJson) {
    let schema;
    try {
      schema = typeof schemaJson === "string" ? JSON.parse(schemaJson) : schemaJson;
    } catch {
      schema = null;
    }
    if (schema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = schema;
    }
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt || "" }] }],
    generationConfig,
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err = new Error(`Gemini HTTP ${resp.status}`);
    err.status = resp.status;
    err.detail = detail;
    throw err;
  }

  const json = await resp.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  return text.trim();
}

module.exports = { generate, MODEL };

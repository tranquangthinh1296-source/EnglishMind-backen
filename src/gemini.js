// Server-side Gemini caller. API key lives only here (env), never on the client.
const API_KEY = process.env.GEMINI_API_KEY;

const PRIMARY_MODEL =
  process.env.GEMINI_MODEL_DEFAULT ||
  process.env.GEMINI_MODEL ||
  "gemini-2.5-flash-lite";

const FALLBACK_MODEL = process.env.GEMINI_MODEL_FALLBACK || "gemini-2.5-flash";

// Legacy export: primary model id (gateway status / logs).
const MODEL = PRIMARY_MODEL;

function isRetryableUpstream(status) {
  return status === 429 || status === 503 || status === 500;
}

const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const MAX_OUTPUT_TOKENS_CAP = 8192;

async function callModel(model, { prompt, systemInstruction, schemaJson, maxOutputTokens }) {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not configured");

  // Accept any Google AI Studio key shape (AIza…, AQ. auth keys, etc.) — no prefix gate.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const generationConfig = {
    maxOutputTokens:
      typeof maxOutputTokens === "number" && maxOutputTokens > 0
        ? Math.min(maxOutputTokens, MAX_OUTPUT_TOKENS_CAP)
        : DEFAULT_MAX_OUTPUT_TOKENS,
  };
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
    safetySettings: SAFETY_SETTINGS,
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err = new Error(`Gemini HTTP ${resp.status}`);
    err.status = resp.status;
    err.detail = detail;
    err.model = model;
    throw err;
  }

  const json = await resp.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const um = json?.usageMetadata || {};
  const usage = {
    promptTokens: um.promptTokenCount || 0,
    candidatesTokens: um.candidatesTokenCount || 0,
    totalTokens: um.totalTokenCount || 0,
  };
  return { text: text.trim(), model, usage };
}

async function generate({ prompt, systemInstruction, schemaJson, maxOutputTokens }) {
  try {
    const primary = await callModel(PRIMARY_MODEL, {
      prompt,
      systemInstruction,
      schemaJson,
      maxOutputTokens,
    });
    return {
      text: primary.text,
      model: primary.model,
      usedFallback: false,
      usage: primary.usage,
    };
  } catch (primaryErr) {
    if (
      FALLBACK_MODEL &&
      FALLBACK_MODEL !== PRIMARY_MODEL &&
      isRetryableUpstream(primaryErr.status)
    ) {
      console.warn(
        `[gemini] primary ${PRIMARY_MODEL} failed (${primaryErr.status}); retry ${FALLBACK_MODEL}`,
      );
      const fallback = await callModel(FALLBACK_MODEL, {
        prompt,
        systemInstruction,
        schemaJson,
        maxOutputTokens,
      });
      return {
        text: fallback.text,
        model: fallback.model,
        usedFallback: true,
        usage: fallback.usage,
      };
    }
    throw primaryErr;
  }
}

module.exports = {
  generate,
  MODEL,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
};

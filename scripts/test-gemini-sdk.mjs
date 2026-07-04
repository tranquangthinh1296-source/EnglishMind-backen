import { GoogleGenAI } from "@google/genai";

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY not set");
  process.exit(1);
}
console.log("key_prefix=", key.slice(0, 4), "len=", key.length);

const ai = new GoogleGenAI({ apiKey: key });
try {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-lite",
    contents: "Reply with exactly: OK",
  });
  console.log("SDK OK:", (response.text || "").slice(0, 80));
} catch (e) {
  console.error("SDK FAIL:", e?.message || e);
  if (e?.status) console.error("status:", e.status);
}

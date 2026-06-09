// POST api/ai/generate — Pro AI proxy.
// Pipeline: verifyAuth (T37-BE) → checkQuota (T38-BE) → Gemini.
//
// Client body (EnglishMindRepository.callGeminiJson):
//   { task, prompt, systemInstruction, schemaJson }
// Client parses the response as either a raw JSON string, or an object with
// { success:false, error } / { data:"<json>" } / { responseText:"<json>" }.
const express = require("express");
const { verifyAuth } = require("../middleware/verifyAuth");
const { checkQuota } = require("../middleware/checkQuota");
const { generate } = require("../gemini");

const router = express.Router();

router.post("/ai/generate", verifyAuth, checkQuota, async (req, res) => {
  const { prompt, systemInstruction, schemaJson } = req.body || {};

  try {
    const data = await generate({ prompt, systemInstruction, schemaJson });
    return res.json({ success: true, data });
  } catch (e) {
    // Don't burn a quota unit for our own failure.
    if (req.refundQuota) await req.refundQuota();
    console.error("[ai/generate] Gemini call failed:", e.status || "", e.message, e.detail || "");
    const status = e.status === 429 ? 429 : 502;
    return res.status(status).json({
      success: false,
      error: "ai_upstream_error",
      errorMessage: "Không gọi được AI. Vui lòng thử lại.",
    });
  }
});

module.exports = router;

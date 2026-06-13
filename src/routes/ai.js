const express = require("express");
const { verifyAuth } = require("../middleware/verifyAuth");
const { checkQuota } = require("../middleware/checkQuota");
const { generate, MODEL } = require("../gemini");
const gatewayStats = require("../services/gatewayStats");

const router = express.Router();

function deployRegion() {
  return (
    process.env.RAILWAY_REGION ||
    process.env.DEPLOY_REGION ||
    process.env.RAILWAY_ENVIRONMENT_REGION ||
    "unknown"
  );
}

// Public metadata for Beta Diagnostics (no auth — no secrets).
router.get("/gateway/status", (_req, res) => {
  const stats = gatewayStats.snapshot();
  res.json({
    ok: true,
    model: MODEL,
    region: deployRegion(),
    successRate: stats.successRate,
    sampleSize: stats.totalCalls,
    service: "englishmind-ai-gateway",
  });
});

function logAiCallMeta({ taskType, plan, quotaCost, success, errorCode, latencyMs, cacheHit = false }) {
  console.log(
    JSON.stringify({
      event: "ai_call",
      taskType,
      plan,
      quotaCost,
      provider: "gemini",
      model: MODEL,
      latencyMs,
      cacheHit,
      success,
      errorCode: errorCode || null,
      quotaBlocked: errorCode === "quota_exceeded",
      upstreamError: errorCode === "ai_upstream_error",
    }),
  );
}

router.post("/ai/generate", verifyAuth, checkQuota, async (req, res) => {
  const { taskType, prompt, systemInstruction, schemaJson, schemaVersion } = req.body || {};
  const started = Date.now();

  if (!prompt || !systemInstruction || !schemaJson) {
    if (req.refundQuota) await req.refundQuota();
    return res.status(400).json({
      success: false,
      error: "invalid_request",
      errorMessage: "Thiếu prompt, systemInstruction hoặc schemaJson.",
    });
  }

  try {
    const data = await generate({ prompt, systemInstruction, schemaJson });
    if (req.incrementDailyStats) {
      await req.incrementDailyStats({ cacheMisses: 1 });
    }
    const latencyMs = Date.now() - started;
    gatewayStats.recordCall(true);
    logAiCallMeta({
      taskType,
      plan: req.plan,
      quotaCost: req.quota?.cost,
      success: true,
      latencyMs,
    });
    return res.json({
      success: true,
      data,
      quota: req.quota,
      provider: { id: "gemini", model: MODEL },
    });
  } catch (e) {
    if (req.refundQuota) await req.refundQuota();
    if (req.incrementDailyStats) {
      await req.incrementDailyStats({ upstreamErrorCount: 1, cacheMisses: 1 });
    }
    const latencyMs = Date.now() - started;
    const errorCode = e.status === 429 ? "ai_upstream_error" : "ai_upstream_error";
    gatewayStats.recordCall(false);
    logAiCallMeta({
      taskType,
      plan: req.plan,
      quotaCost: req.quota?.cost,
      success: false,
      errorCode,
      latencyMs,
    });
    console.error("[ai/generate] upstream failed:", e.status || "", e.message);
    const status = e.status === 429 ? 429 : 502;
    return res.status(status).json({
      success: false,
      error: errorCode,
      errorMessage: "Cô Vy đang mất kết nối với AI. Anh vẫn có thể học bài đã lưu offline.",
    });
  }
});

module.exports = router;

const express = require("express");
const { verifyAuth } = require("../middleware/verifyAuth");
const { checkQuota } = require("../middleware/checkQuota");
const { generate, MODEL, PRIMARY_MODEL, FALLBACK_MODEL } = require("../gemini");
const gatewayStats = require("../services/gatewayStats");
const costEstimator = require("../services/costEstimator");
const contentPolicy = require("../services/contentPolicy");
const opsMetrics = require("../services/opsMetrics");
const { appCheckMonitor } = require("../middleware/appCheck");
const { costGuard } = require("../middleware/costGuard");
const { createIpLimiter, createUidLimiter } = require("../middleware/rateLimits");
const { resolveSystemInstruction: resolveSystemInstructionBody } = require("../services/systemInstructions");

const PLATFORM_HEADER = "x-englishmind-platform";

function resolvePlatform(req) {
  return opsMetrics.normalizePlatform(req.headers[PLATFORM_HEADER]);
}

const router = express.Router();
const aiIpLimiter = createIpLimiter();
const aiUidLimiter = createUidLimiter("RATE_AI_UID_5M", 30);

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
    primaryModel: PRIMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    region: deployRegion(),
    successRate: stats.successRate,
    sampleSize: stats.totalCalls,
    service: "englishmind-ai-gateway",
  });
});

function resolveSystemInstruction(req, res, next) {
  const resolved = resolveSystemInstructionBody(req.body || {}, {
    requireServerSi: process.env.REQUIRE_SERVER_SI === "true",
  });
  if (!resolved.ok) {
    const message =
      resolved.error === "server_system_instruction_required"
        ? "Loại tác vụ AI chưa được cấu hình prompt server."
        : "Tham số prompt không hợp lệ.";
    return res.status(400).json({
      success: false,
      error: resolved.error,
      errorMessage: message,
      field: resolved.field,
    });
  }
  req.resolvedSystemInstruction = resolved.systemInstruction;
  req.systemInstructionSource = resolved.source;
  if (resolved.legacy) opsMetrics.recordLegacySystemInstruction(req.body?.taskType).catch(() => {});
  return next();
}

function logAiCallMeta({
  taskType,
  plan,
  quotaCost,
  success,
  errorCode,
  latencyMs,
  cacheHit = false,
  model = MODEL,
  totalTokens = null,
  estCostUsd = null,
  platform = "unknown",
}) {
  console.log(
    JSON.stringify({
      event: "ai_call",
      taskType,
      plan,
      platform,
      quotaCost,
      provider: "gemini",
      model,
      totalTokens,
      estCostUsd,
      latencyMs,
      cacheHit,
      success,
      errorCode: errorCode || null,
      quotaBlocked: errorCode === "quota_exceeded",
      upstreamError: errorCode === "ai_upstream_error",
    }),
  );
}

router.post(
  "/ai/generate",
  aiIpLimiter,
  appCheckMonitor(),
  verifyAuth,
  aiUidLimiter,
  costGuard,
  resolveSystemInstruction,
  checkQuota,
  async (req, res) => {
  const { taskType, prompt, schemaJson, schemaVersion, maxOutputTokens } = req.body || {};
  const systemInstruction = req.resolvedSystemInstruction || "";
  const started = Date.now();
  const platform = resolvePlatform(req);

  if (!prompt || !systemInstruction || !schemaJson) {
    if (req.refundQuota) await req.refundQuota();
    return res.status(400).json({
      success: false,
      error: "invalid_request",
      errorMessage: "Thiếu prompt, systemInstruction hoặc schemaJson.",
    });
  }

  const policy = contentPolicy.check({ taskType, prompt, systemInstruction });
  if (!policy.ok) {
    if (req.refundQuota) await req.refundQuota();
    opsMetrics.recordPolicyBlock(taskType, platform).catch(() => {});
    console.log(
      JSON.stringify({
        event: "ai_policy_blocked",
        taskType: taskType || null,
        platform,
        code: policy.code,
      }),
    );
    return res.status(400).json({
      success: false,
      error: policy.error,
      errorMessage: policy.errorMessage,
    });
  }

  try {
    const parsedMaxOutput =
      typeof maxOutputTokens === "number" && Number.isFinite(maxOutputTokens)
        ? maxOutputTokens
        : undefined;
    const result = await generate({
      prompt,
      systemInstruction,
      schemaJson,
      maxOutputTokens: parsedMaxOutput,
    });
    const actualModel = result.model || MODEL;
    if (req.incrementDailyStats) {
      await req.incrementDailyStats({ cacheMisses: 1 });
    }
    const latencyMs = Date.now() - started;
    gatewayStats.recordCall(true);
    const usage = result.usage || {};
    const estCostUsd = costEstimator.estimateCostUsd(actualModel, usage);
    costEstimator.addCost(estCostUsd);
    logAiCallMeta({
      taskType,
      plan: req.plan,
      quotaCost: req.quota?.cost,
      success: true,
      latencyMs,
      model: actualModel,
      totalTokens: usage.totalTokens || null,
      estCostUsd,
      platform,
    });
    opsMetrics
      .recordAiCall({
        platform,
        taskType,
        success: true,
        estCostUsd,
      })
      .catch(() => {});
    return res.json({
      success: true,
      data: result.text,
      quota: req.quota,
      provider: {
        id: "gemini",
        model: actualModel,
        usedFallback: result.usedFallback === true,
      },
    });
  } catch (e) {
    if (req.refundQuota) await req.refundQuota();
    if (req.incrementDailyStats) {
      await req.incrementDailyStats({ upstreamErrorCount: 1, cacheMisses: 1 });
    }
    const latencyMs = Date.now() - started;
    const errorCode = "ai_upstream_error";
    gatewayStats.recordCall(false);
    logAiCallMeta({
      taskType,
      plan: req.plan,
      quotaCost: req.quota?.cost,
      success: false,
      errorCode,
      latencyMs,
      platform,
    });
    opsMetrics
      .recordAiCall({
        platform,
        taskType,
        success: false,
        errorCode,
      })
      .catch(() => {});
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

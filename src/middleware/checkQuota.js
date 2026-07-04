// Plan-based atomic daily quota (AI-SAFE-3).
const { db } = require("../firebase");
const opsMetrics = require("../services/opsMetrics");
const { notifyOpsAlert } = require("../services/alertWebhook");

const TZ = process.env.QUOTA_TIMEZONE || "Asia/Ho_Chi_Minh";
const DEFAULT_QUOTA_TIMEOUT_MS = 5000;
const TIMEOUT_MS = parseInt(
  process.env.AI_QUOTA_TIMEOUT_MS || String(DEFAULT_QUOTA_TIMEOUT_MS),
  10,
);
const QUOTA_RESERVE_MAX_ATTEMPTS = 2;

const PLAN_LIMITS = {
  free: parseInt(process.env.FREE_DAILY_AI_UNITS || "5", 10),
  plus: parseInt(process.env.PLUS_DAILY_AI_UNITS || "100", 10),
  pro: parseInt(process.env.PRO_DAILY_AI_UNITS || "250", 10),
  coach_beta: parseInt(process.env.COACH_BETA_DAILY_AI_UNITS || "250", 10),
};

const SPEAKING_PACK_FREE_DAILY_LIMIT = parseInt(
  process.env.SPEAKING_PACK_FREE_DAILY_LIMIT || "2",
  10,
);

const PRO_PLANS = new Set(["pro", "coach_beta", "admin"]);
const INTERNAL_BETA_PLANS = new Set(["coach_beta", "admin"]);

const TASK_POLICIES = {
  translate_core: { cost: 1, betaStatus: "BETA_READY" },
  word_lookup: { cost: 1, betaStatus: "BETA_READY" },
  phonetics_on_demand: { cost: 1, betaStatus: "BETA_READY" },
  reinforcement_on_demand: { cost: 1, betaStatus: "BETA_SIMPLIFIED" },
  speak_english_teacher: { cost: 1, betaStatus: "BETA_READY" },
  speaking_pack_generation: {
    cost: 1,
    betaStatus: "BETA_READY",
    freeDailyLimit: SPEAKING_PACK_FREE_DAILY_LIMIT,
  },
  // TODO owner-decision: conversation Pro-gate khi GA.
  conversation_turn: { cost: 2, betaStatus: "QA_REQUIRED" },
  scripted_dialogue: { cost: 1, betaStatus: "QA_REQUIRED" },
  voice_analysis_short: { cost: 2, betaStatus: "QA_REQUIRED", requiresPro: true },
  roadmap_generation: { cost: 10, betaStatus: "POST_BETA", requiresPro: true },
  content_generation: { cost: 30, betaStatus: "POST_BETA", requiresPro: true },
  // Web-Lite tools (PROMPT-GOV-WEB-1) — one Gemini call each, cost 1 per OD-09.
  teacher_translate: { cost: 1, betaStatus: "BETA_READY" },
  conversation_reply: { cost: 1, betaStatus: "BETA_READY" },
  context_translate: { cost: 1, betaStatus: "BETA_READY" },
  email_write: { cost: 1, betaStatus: "BETA_READY" },
  email_rewrite: { cost: 1, betaStatus: "BETA_READY" },
  reply_assistant: { cost: 1, betaStatus: "BETA_READY" },
};

const TASK_COSTS = Object.fromEntries(
  Object.entries(TASK_POLICIES).map(([taskType, policy]) => [taskType, policy.cost]),
);

function serverDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Next midnight in TZ, as ISO instant — tells the client when the daily quota resets.
function nextResetAtIso() {
  const [y, m, d] = serverDay().split("-").map(Number);
  const tomorrowUtcGuess = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const asIfUtc = new Date(tomorrowUtcGuess.toLocaleString("en-US", { timeZone: "UTC" }));
  const asIfTz = new Date(tomorrowUtcGuess.toLocaleString("en-US", { timeZone: TZ }));
  const offsetMs = asIfUtc.getTime() - asIfTz.getTime();
  return new Date(tomorrowUtcGuess.getTime() + offsetMs).toISOString();
}

function resolveLimit(plan) {
  if (plan === "admin") {
    const adminLimit = parseInt(process.env.ADMIN_DAILY_AI_UNITS || "", 10);
    if (!Number.isFinite(adminLimit) || adminLimit <= 0) return null;
    return adminLimit;
  }
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

function resolveTaskCost(taskType) {
  const key = normalizeTaskType(taskType);
  return key ? TASK_COSTS[key] ?? null : null;
}

function normalizeTaskType(taskType) {
  if (!taskType || typeof taskType !== "string") return null;
  const key = taskType.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TASK_POLICIES, key) ? key : null;
}

function resolveTaskPolicy(taskType) {
  const key = normalizeTaskType(taskType);
  return key ? TASK_POLICIES[key] : null;
}

function hasProPlan(plan) {
  return PRO_PLANS.has(plan);
}

function hasInternalBetaAccess(req, plan) {
  const claims = req.claims || {};
  return (
    INTERNAL_BETA_PLANS.has(plan) ||
    claims.admin === true ||
    claims.internalTester === true ||
    claims.betaTester === true ||
    claims.qaTester === true
  );
}

function isPostBetaOpen(req) {
  const claims = req.claims || {};
  return process.env.POST_BETA_FEATURES_ENABLED === "true" || claims.postBetaOpen === true;
}

function resolveTaskAccess(req, plan, policy) {
  if (policy.requiresPro && !hasProPlan(plan)) {
    return { ok: false, status: 403, error: "pro_required" };
  }

  if (policy.betaStatus === "QA_REQUIRED" && !hasInternalBetaAccess(req, plan)) {
    return { ok: false, status: 403, error: "beta_status_restricted" };
  }

  if (policy.betaStatus === "POST_BETA" && !hasInternalBetaAccess(req, plan) && !isPostBetaOpen(req)) {
    return { ok: false, status: 403, error: "beta_status_restricted" };
  }

  return { ok: true };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("quota_timeout")), ms)),
  ]);
}

async function reserveWithTimeout(uid, plan, cost, taskType) {
  let lastErr;
  for (let attempt = 1; attempt <= QUOTA_RESERVE_MAX_ATTEMPTS; attempt++) {
    try {
      return await withTimeout(reserve(uid, plan, cost, taskType), TIMEOUT_MS);
    } catch (e) {
      lastErr = e;
      if (e.message !== "quota_timeout" || attempt === QUOTA_RESERVE_MAX_ATTEMPTS) {
        throw e;
      }
      console.warn(
        `[checkQuota] reserve timeout attempt ${attempt}/${QUOTA_RESERVE_MAX_ATTEMPTS}, retrying`,
      );
    }
  }
  throw lastErr;
}

async function reserve(uid, plan, cost, taskType) {
  const limit = resolveLimit(plan);
  if (limit == null) {
    return { ok: false, reason: "admin_limit_missing" };
  }
  const ref = db.doc(`aiQuota/${uid}/days/${serverDay()}`);
  const today = serverDay();
  const taskKey = normalizeTaskType(taskType);
  const policy = taskKey ? TASK_POLICIES[taskKey] : null;

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const unitsUsed = data && data.date === today ? data.unitsUsed || 0 : 0;
    const calls = data && data.date === today ? data.calls || 0 : 0;
    const taskCounts = data && data.date === today && data.taskCounts ? data.taskCounts : {};
    const taskCount = taskKey ? Number(taskCounts[taskKey] || 0) : 0;

    if (unitsUsed + cost > limit) {
      return { ok: false, count: unitsUsed, limit, unitsUsed, remainingToday: Math.max(0, limit - unitsUsed) };
    }

    if (
      policy &&
      plan === "free" &&
      Number.isFinite(policy.freeDailyLimit) &&
      taskCount + 1 > policy.freeDailyLimit
    ) {
      return {
        ok: false,
        reason: "feature_daily_limit_exceeded",
        taskType: taskKey,
        taskCount,
        taskLimit: policy.freeDailyLimit,
        limit,
        unitsUsed,
        remainingToday: Math.max(0, limit - unitsUsed),
      };
    }

    const nextUnits = unitsUsed + cost;
    const nextCalls = calls + 1;
    const nextTaskCounts = taskKey
      ? { ...taskCounts, [taskKey]: taskCount + 1 }
      : taskCounts;
    tx.set(
      ref,
      {
        date: today,
        unitsUsed: nextUnits,
        calls: nextCalls,
        taskCounts: nextTaskCounts,
        plan,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return {
      ok: true,
      count: nextCalls,
      limit,
      unitsUsed: nextUnits,
      remainingToday: Math.max(0, limit - nextUnits),
      cost,
      taskType: taskKey,
      taskCountToday: taskKey ? nextTaskCounts[taskKey] : null,
      taskLimit: policy && Number.isFinite(policy.freeDailyLimit) ? policy.freeDailyLimit : null,
    };
  });
}

async function refund(uid, cost, taskType) {
  const ref = db.doc(`aiQuota/${uid}/days/${serverDay()}`);
  const today = serverDay();
  const taskKey = normalizeTaskType(taskType);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      if (data.date !== today) return;
      const nextUnits = Math.max(0, (data.unitsUsed || 0) - cost);
      const nextCalls = Math.max(0, (data.calls || 0) - 1);
      const update = { unitsUsed: nextUnits, calls: nextCalls, updatedAt: Date.now() };
      if (taskKey && data.taskCounts) {
        update.taskCounts = {
          ...data.taskCounts,
          [taskKey]: Math.max(0, Number(data.taskCounts[taskKey] || 0) - 1),
        };
      }
      tx.set(ref, update, { merge: true });
    });
  } catch (e) {
    console.error("[checkQuota] refund failed:", e.message);
  }
}

async function incrementDailyStats(uid, delta = {}) {
  const ref = db.doc(`aiQuota/${uid}/days/${serverDay()}`);
  const today = serverDay();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      const base = {
        date: today,
        unitsUsed: data && data.date === today ? data.unitsUsed || 0 : 0,
        calls: data && data.date === today ? data.calls || 0 : 0,
        quotaBlockedCount: data && data.date === today ? data.quotaBlockedCount || 0 : 0,
        upstreamErrorCount: data && data.date === today ? data.upstreamErrorCount || 0 : 0,
        cacheHits: data && data.date === today ? data.cacheHits || 0 : 0,
        cacheMisses: data && data.date === today ? data.cacheMisses || 0 : 0,
        plan: (data && data.date === today && data.plan) || delta.plan || "free",
        updatedAt: Date.now(),
      };
      tx.set(
        ref,
        {
          ...base,
          quotaBlockedCount: base.quotaBlockedCount + (delta.quotaBlockedCount || 0),
          upstreamErrorCount: base.upstreamErrorCount + (delta.upstreamErrorCount || 0),
          cacheHits: base.cacheHits + (delta.cacheHits || 0),
          cacheMisses: base.cacheMisses + (delta.cacheMisses || 0),
        },
        { merge: true },
      );
    });
  } catch (e) {
    console.error("[checkQuota] increment stats failed:", e.message);
  }
}

async function checkQuota(req, res, next) {
  const taskType = req.body && req.body.taskType;
  const taskKey = normalizeTaskType(taskType);
  const policy = resolveTaskPolicy(taskKey);
  if (!policy) {
    return res.status(400).json({
      success: false,
      error: "invalid_task_type",
      errorMessage: "Loại tác vụ AI không hợp lệ.",
    });
  }
  const cost = policy.cost;

  const plan = req.plan || "free";
  const access = resolveTaskAccess(req, plan, policy);
  if (!access.ok) {
    return res.status(access.status).json({
      success: false,
      error: access.error,
      errorMessage:
        access.error === "pro_required"
          ? "Tính năng này dành cho tài khoản Pro."
          : "Tính năng này đang trong giai đoạn thử nghiệm nội bộ.",
    });
  }

  const limit = resolveLimit(plan);
  if (limit == null) {
    return res.status(503).json({
      success: false,
      error: "quota_unavailable",
      errorMessage: "Không kiểm tra được hạn mức. Thử lại sau.",
    });
  }

  try {
    const result = await reserveWithTimeout(req.uid, plan, cost, taskKey);
    if (!result.ok) {
      const platform = opsMetrics.normalizePlatform(req.headers["x-englishmind-platform"]);
      await incrementDailyStats(req.uid, { quotaBlockedCount: 1, plan });
      const errorCode =
        result.reason === "feature_daily_limit_exceeded"
          ? "feature_daily_limit_exceeded"
          : "quota_exceeded";
      opsMetrics.recordAiCall({ platform, taskType: taskKey, success: false, errorCode }).catch(() => {});
      return res.status(429).json({
        success: false,
        error: errorCode,
        errorMessage:
          errorCode === "feature_daily_limit_exceeded"
            ? "Tài khoản miễn phí đã dùng hết lượt tạo Speaking Pack hôm nay."
            : "Hôm nay mình đã dùng hết lượt luyện. Anh quay lại vào ngày mai nhé.",
        quota: {
          plan,
          cost,
          limit: result.limit,
          unitsUsedToday: result.unitsUsed ?? result.count,
          remainingToday: result.remainingToday ?? 0,
          resetAt: nextResetAtIso(),
          taskType: result.taskType || taskKey,
          taskUsedToday: result.taskCount ?? null,
          taskLimit: result.taskLimit ?? null,
        },
      });
    }
    req.quota = {
      plan,
      cost,
      limit: result.limit,
      unitsUsedToday: result.unitsUsed,
      remainingToday: result.remainingToday,
      resetAt: nextResetAtIso(),
      taskType: result.taskType || taskKey,
      taskUsedToday: result.taskCountToday,
      taskLimit: result.taskLimit,
    };
    req.refundQuota = () => refund(req.uid, cost, taskKey);
    req.incrementDailyStats = (delta) => incrementDailyStats(req.uid, { ...delta, plan });
    next();
  } catch (e) {
    const reason = e.message === "quota_timeout" ? "timeout" : "firestore_error";
    opsMetrics.recordQuotaUnavailable().catch(() => {});
    notifyOpsAlert("quota_store_unavailable", {
      reason,
      timeoutMs: TIMEOUT_MS,
    }).catch(() => {});
    console.error(
      JSON.stringify({
        event: "quota_reserve_failed",
        reason,
        timeoutMs: TIMEOUT_MS,
        message: e.message,
      }),
    );
    return res.status(503).json({
      success: false,
      error: "quota_unavailable",
      errorMessage: "Hệ thống đang kiểm tra lượt AI. Anh thử lại sau ít phút nhé.",
    });
  }
}

module.exports = {
  checkQuota,
  reserve,
  reserveWithTimeout,
  refund,
  incrementDailyStats,
  serverDay,
  resolveLimit,
  resolveTaskCost,
  resolveTaskPolicy,
  resolveTaskAccess,
  normalizeTaskType,
  TASK_COSTS,
  TASK_POLICIES,
  PLAN_LIMITS,
  SPEAKING_PACK_FREE_DAILY_LIMIT,
  DEFAULT_QUOTA_TIMEOUT_MS,
  QUOTA_RESERVE_MAX_ATTEMPTS,
};

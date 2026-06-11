// Plan-based atomic daily quota (AI-SAFE-3).
const { db } = require("../firebase");

const TZ = process.env.QUOTA_TIMEZONE || "Asia/Ho_Chi_Minh";
const TIMEOUT_MS = parseInt(process.env.AI_QUOTA_TIMEOUT_MS || "1500", 10);

const PLAN_LIMITS = {
  free: parseInt(process.env.FREE_DAILY_AI_UNITS || "10", 10),
  plus: parseInt(process.env.PLUS_DAILY_AI_UNITS || "100", 10),
  pro: parseInt(process.env.PRO_DAILY_AI_UNITS || "250", 10),
  coach_beta: parseInt(process.env.COACH_BETA_DAILY_AI_UNITS || "250", 10),
};

const TASK_COSTS = {
  translate_core: 1,
  word_lookup: 1,
  phonetics_on_demand: 1,
  reinforcement_on_demand: 1,
  speak_english_teacher: 1,
  conversation_turn: 2,
  voice_analysis_short: 2,
  roadmap_generation: 10,
  content_generation: 30,
};

function serverDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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
  if (!taskType || typeof taskType !== "string") return null;
  const key = taskType.trim().toLowerCase();
  return TASK_COSTS[key] ?? null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("quota_timeout")), ms)),
  ]);
}

async function reserve(uid, plan, cost) {
  const limit = resolveLimit(plan);
  if (limit == null) {
    return { ok: false, reason: "admin_limit_missing" };
  }
  const ref = db.doc(`aiQuota/${uid}/days/${serverDay()}`);
  const today = serverDay();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const unitsUsed = data && data.date === today ? data.unitsUsed || 0 : 0;
    const calls = data && data.date === today ? data.calls || 0 : 0;

    if (unitsUsed + cost > limit) {
      return { ok: false, count: unitsUsed, limit, unitsUsed, remainingToday: Math.max(0, limit - unitsUsed) };
    }

    const nextUnits = unitsUsed + cost;
    const nextCalls = calls + 1;
    tx.set(
      ref,
      {
        date: today,
        unitsUsed: nextUnits,
        calls: nextCalls,
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
    };
  });
}

async function refund(uid, cost) {
  const ref = db.doc(`aiQuota/${uid}/days/${serverDay()}`);
  const today = serverDay();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      if (data.date !== today) return;
      const nextUnits = Math.max(0, (data.unitsUsed || 0) - cost);
      const nextCalls = Math.max(0, (data.calls || 0) - 1);
      tx.set(ref, { unitsUsed: nextUnits, calls: nextCalls, updatedAt: Date.now() }, { merge: true });
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
  const cost = resolveTaskCost(taskType);
  if (cost == null) {
    return res.status(400).json({
      success: false,
      error: "invalid_task_type",
      errorMessage: "Loại tác vụ AI không hợp lệ.",
    });
  }

  const plan = req.plan || "free";
  const limit = resolveLimit(plan);
  if (limit == null) {
    return res.status(503).json({
      success: false,
      error: "quota_unavailable",
      errorMessage: "Không kiểm tra được hạn mức. Thử lại sau.",
    });
  }

  try {
    const result = await withTimeout(reserve(req.uid, plan, cost), TIMEOUT_MS);
    if (!result.ok) {
      await incrementDailyStats(req.uid, { quotaBlockedCount: 1, plan });
      return res.status(429).json({
        success: false,
        error: "quota_exceeded",
        errorMessage: "Hôm nay mình đã dùng hết lượt luyện. Anh quay lại vào ngày mai nhé.",
        quota: {
          plan,
          cost,
          limit: result.limit,
          unitsUsedToday: result.unitsUsed ?? result.count,
          remainingToday: result.remainingToday ?? 0,
        },
      });
    }
    req.quota = {
      plan,
      cost,
      limit: result.limit,
      unitsUsedToday: result.unitsUsed,
      remainingToday: result.remainingToday,
    };
    req.refundQuota = () => refund(req.uid, cost);
    req.incrementDailyStats = (delta) => incrementDailyStats(req.uid, { ...delta, plan });
    next();
  } catch (e) {
    console.error("[checkQuota] reserve failed:", e.message);
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
  refund,
  incrementDailyStats,
  serverDay,
  resolveLimit,
  resolveTaskCost,
  TASK_COSTS,
  PLAN_LIMITS,
};

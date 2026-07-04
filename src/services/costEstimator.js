// Rough AI cost estimator for ops visibility (beta). NOT billing-grade.
// Token counts come from Gemini usageMetadata; prices are USD per 1,000,000 tokens.
// Public Gemini Flash-tier estimates — override per model via env if pricing drifts.
const { notifyOpsAlert } = require("./alertWebhook");

function pricePer1M(envName, fallback) {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// model id -> { input, output } USD per 1M tokens.
function ratesFor(model) {
  const m = (model || "").toLowerCase();
  if (m.includes("flash-lite")) {
    return {
      input: pricePer1M("COST_FLASH_LITE_INPUT_PER_1M", 0.1),
      output: pricePer1M("COST_FLASH_LITE_OUTPUT_PER_1M", 0.4),
    };
  }
  // Default to (non-lite) flash rates for anything else.
  return {
    input: pricePer1M("COST_FLASH_INPUT_PER_1M", 0.3),
    output: pricePer1M("COST_FLASH_OUTPUT_PER_1M", 2.5),
  };
}

function round(value, dp) {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// Estimate the USD cost of one call from its token usage.
function estimateCostUsd(model, usage = {}) {
  const promptTokens = Number(usage.promptTokens) || 0;
  const outputTokens = Number(usage.candidatesTokens) || 0;
  const rates = ratesFor(model);
  const usd = (promptTokens / 1e6) * rates.input + (outputTokens / 1e6) * rates.output;
  return round(usd, 6);
}

// In-memory daily accumulator. Firestore persistence below is best-effort so
// a Firestore blip never takes AI/STT down; Google Cloud budget remains the
// final backstop.
let day = currentDay();
let dailyUsd = 0;
let alerted = false;
let restoredDay = null;
let dailyStoreForTest = null;

function currentDay() {
  return new Date().toISOString().slice(0, 10);
}

function rollIfNewDay() {
  const today = currentDay();
  if (today !== day) {
    day = today;
    dailyUsd = 0;
    alerted = false;
    restoredDay = null;
  }
}

function costDailyRef(date = currentDay()) {
  if (dailyStoreForTest) return dailyStoreForTest.ref(date);
  const { db } = require("../firebase");
  return db.collection("opsMetrics").doc("costDaily").collection("days").doc(date);
}

function parseCapUsd() {
  const cap = Number(process.env.COST_KILL_DAILY_USD);
  return Number.isFinite(cap) && cap > 0 ? cap : null;
}

async function restoreDailyCostFromFirestore() {
  rollIfNewDay();
  if (restoredDay === day) return { ok: true, day, dailyUsd };
  try {
    const snap = await costDailyRef(day).get();
    if (snap.exists) {
      const data = snap.data() || {};
      dailyUsd = Number(data.dailyUsdEst || data.dailyUsd || 0) || 0;
      alerted = Boolean(data.alerted);
    }
    restoredDay = day;
    return { ok: true, day, dailyUsd };
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "cost_daily_restore_failed",
        day,
        message: e.message,
      }),
    );
    return { ok: false, day, dailyUsd, error: e.message };
  }
}

function persistDailyCost(usdDelta) {
  if (!(Number(usdDelta) > 0)) return;
  const date = day;
  const payload = {
    date,
    updatedAt: Date.now(),
    dailyUsdEst: round(dailyUsd, 6),
    lastIncrementUsd: round(Number(usdDelta) || 0, 6),
    alerted,
  };
  const write = async () => {
    const ref = costDailyRef(date);
    if (dailyStoreForTest) {
      await ref.set(payload, { merge: true, increment: Number(usdDelta) || 0 });
      return;
    }
    const { FieldValue } = require("firebase-admin/firestore");
    await ref.set(
      {
        ...payload,
        dailyUsd: FieldValue.increment(Number(usdDelta) || 0),
      },
      { merge: true },
    );
  };
  write().catch((e) => {
    console.error(
      JSON.stringify({
        event: "cost_daily_persist_failed",
        day: date,
        message: e.message,
      }),
    );
  });
}

// Add one call's cost; emit a single cost_alert per day when COST_ALERT_DAILY_USD is crossed.
function addCost(usd) {
  rollIfNewDay();
  const delta = Number(usd) || 0;
  dailyUsd += delta;
  const threshold = Number(process.env.COST_ALERT_DAILY_USD);
  if (Number.isFinite(threshold) && threshold > 0 && dailyUsd >= threshold && !alerted) {
    alerted = true;
    const alertPayload = {
      day,
      dailyUsdEst: round(dailyUsd, 4),
      thresholdUsd: threshold,
    };
    console.warn(JSON.stringify({ event: "cost_alert", ...alertPayload }));
    notifyOpsAlert("cost_alert", alertPayload).catch(() => {});
  }
  persistDailyCost(delta);
  return dailyUsd;
}

function isCostCapReached() {
  rollIfNewDay();
  const cap = parseCapUsd();
  return cap != null && dailyUsd >= cap;
}

function snapshot() {
  rollIfNewDay();
  return { day, dailyUsdEst: round(dailyUsd, 4), alerted, killCapUsd: parseCapUsd() };
}

// Test-only: reset the in-memory accumulator.
function __resetForTest() {
  day = currentDay();
  dailyUsd = 0;
  alerted = false;
  restoredDay = null;
  dailyStoreForTest = null;
}

function __setDailyStoreForTest(store) {
  dailyStoreForTest = store;
  restoredDay = null;
}

module.exports = {
  estimateCostUsd,
  addCost,
  snapshot,
  ratesFor,
  isCostCapReached,
  restoreDailyCostFromFirestore,
  __resetForTest,
  __setDailyStoreForTest,
};

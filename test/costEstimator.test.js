const { test } = require("node:test");
const assert = require("node:assert");

function freshModule(env = {}) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k];
  }
  delete require.cache[require.resolve("../src/services/costEstimator")];
  const mod = require("../src/services/costEstimator");
  mod.__resetForTest();
  mod.__setDailyStoreForTest({
    ref() {
      return {
        async get() {
          return { exists: false, data: () => ({}) };
        },
        async set() {},
      };
    },
  });
  return {
    mod,
    restore() {
      for (const k of Object.keys(env)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      delete require.cache[require.resolve("../src/services/costEstimator")];
    },
  };
}

test("estimateCostUsd uses flash-lite rates for the lite model", () => {
  const { mod, restore } = freshModule();
  // 1M input @ $0.10 + 1M output @ $0.40 = $0.50
  const usd = mod.estimateCostUsd("gemini-2.5-flash-lite", {
    promptTokens: 1_000_000,
    candidatesTokens: 1_000_000,
  });
  assert.strictEqual(usd, 0.5);
  restore();
});

test("estimateCostUsd falls back to flash rates for non-lite models", () => {
  const { mod, restore } = freshModule();
  // 1M input @ $0.30 + 1M output @ $2.50 = $2.80
  const usd = mod.estimateCostUsd("gemini-2.5-flash", {
    promptTokens: 1_000_000,
    candidatesTokens: 1_000_000,
  });
  assert.strictEqual(usd, 2.8);
  restore();
});

test("estimateCostUsd handles missing/zero usage safely", () => {
  const { mod, restore } = freshModule();
  assert.strictEqual(mod.estimateCostUsd("gemini-2.5-flash-lite", {}), 0);
  assert.strictEqual(mod.estimateCostUsd("gemini-2.5-flash-lite"), 0);
  restore();
});

test("env override changes the rate table", () => {
  const { mod, restore } = freshModule({ COST_FLASH_LITE_OUTPUT_PER_1M: "1.0" });
  const usd = mod.estimateCostUsd("gemini-2.5-flash-lite", {
    promptTokens: 0,
    candidatesTokens: 1_000_000,
  });
  assert.strictEqual(usd, 1.0);
  restore();
});

test("addCost accumulates and snapshot reflects the running total", () => {
  const { mod, restore } = freshModule();
  mod.addCost(0.01);
  mod.addCost(0.02);
  const snap = mod.snapshot();
  assert.strictEqual(snap.dailyUsdEst, 0.03);
  assert.strictEqual(snap.alerted, false);
  restore();
});

test("restoreDailyCostFromFirestore restores persisted daily cost", async () => {
  const { mod, restore } = freshModule();
  const docs = new Map();
  const today = new Date().toISOString().slice(0, 10);
  docs.set(today, { dailyUsdEst: 1.25, alerted: true });
  mod.__setDailyStoreForTest({
    ref(date) {
      return {
        async get() {
          return {
            exists: docs.has(date),
            data: () => docs.get(date),
          };
        },
        async set(payload) {
          docs.set(date, { ...(docs.get(date) || {}), ...payload });
        },
      };
    },
  });

  const restored = await mod.restoreDailyCostFromFirestore();
  assert.strictEqual(restored.ok, true);
  assert.strictEqual(mod.snapshot().dailyUsdEst, 1.25);
  assert.strictEqual(mod.snapshot().alerted, true);
  restore();
});

test("isCostCapReached reflects COST_KILL_DAILY_USD", () => {
  const { mod, restore } = freshModule({ COST_KILL_DAILY_USD: "0.05" });
  assert.strictEqual(mod.isCostCapReached(), false);
  mod.addCost(0.05);
  assert.strictEqual(mod.isCostCapReached(), true);
  restore();
});

test("addCost emits a single cost_alert once the daily threshold is crossed", () => {
  const { mod, restore } = freshModule({ COST_ALERT_DAILY_USD: "0.05" });
  const warnings = [];
  const orig = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    mod.addCost(0.03); // below
    mod.addCost(0.03); // crosses 0.05
    mod.addCost(0.03); // still over, must NOT alert again
  } finally {
    console.warn = orig;
  }
  const alerts = warnings.filter((w) => String(w).includes("cost_alert"));
  assert.strictEqual(alerts.length, 1);
  assert.ok(mod.snapshot().alerted);
  restore();
});

test("no alert when COST_ALERT_DAILY_USD is unset", () => {
  const { mod, restore } = freshModule();
  const warnings = [];
  const orig = console.warn;
  console.warn = (line) => warnings.push(line);
  try {
    mod.addCost(99);
  } finally {
    console.warn = orig;
  }
  assert.strictEqual(warnings.filter((w) => String(w).includes("cost_alert")).length, 0);
  restore();
});

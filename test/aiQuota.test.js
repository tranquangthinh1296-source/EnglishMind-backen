const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveLimit,
  resolveTaskAccess,
  resolveTaskCost,
  resolveTaskPolicy,
  TASK_COSTS,
  PLAN_LIMITS,
  DEFAULT_QUOTA_TIMEOUT_MS,
  QUOTA_RESERVE_MAX_ATTEMPTS,
} = require("../src/middleware/checkQuota");

describe("aiQuota", () => {
  const originalAdminLimit = process.env.ADMIN_DAILY_AI_UNITS;

  after(() => {
    if (originalAdminLimit === undefined) {
      delete process.env.ADMIN_DAILY_AI_UNITS;
    } else {
      process.env.ADMIN_DAILY_AI_UNITS = originalAdminLimit;
    }
  });

  it("maps plan limits from env defaults", () => {
    assert.equal(resolveLimit("free"), PLAN_LIMITS.free);
    assert.equal(resolveLimit("plus"), PLAN_LIMITS.plus);
    assert.equal(resolveLimit("pro"), PLAN_LIMITS.pro);
    assert.equal(resolveLimit("coach_beta"), PLAN_LIMITS.coach_beta);
    // Owner decision 2026-07-04: free = 5 units/day.
    assert.equal(PLAN_LIMITS.free, 5);
    assert.equal(PLAN_LIMITS.plus, 100);
    assert.equal(PLAN_LIMITS.pro, 250);
  });

  it("requires finite admin env cap", () => {
    delete process.env.ADMIN_DAILY_AI_UNITS;
    assert.equal(resolveLimit("admin"), null);
    process.env.ADMIN_DAILY_AI_UNITS = "500";
    assert.equal(resolveLimit("admin"), 500);
  });

  it("resolves task costs from allowlist only", () => {
    assert.equal(resolveTaskCost("translate_core"), TASK_COSTS.translate_core);
    assert.equal(resolveTaskCost("speak_english_teacher"), 1);
    assert.equal(resolveTaskCost("speaking_pack_generation"), 1);
    assert.equal(resolveTaskCost("conversation_turn"), 2);
    assert.equal(resolveTaskCost("scripted_dialogue"), 1);
    assert.equal(resolveTaskCost("content_generation"), 30);
    assert.equal(resolveTaskCost("local_stt"), null);
    assert.equal(resolveTaskCost(""), null);
    assert.equal(resolveTaskCost(null), null);
  });

  it("uses conservative quota reserve timeout defaults for web cold paths", () => {
    assert.equal(DEFAULT_QUOTA_TIMEOUT_MS, 5000);
    assert.equal(QUOTA_RESERVE_MAX_ATTEMPTS, 2);
  });

  it("allows free internal testers to call conversation_turn within QA_REQUIRED policy", () => {
    const policy = resolveTaskPolicy("conversation_turn");
    const access = resolveTaskAccess({ claims: { betaTester: true } }, "free", policy);
    assert.equal(access.ok, true);
  });
});

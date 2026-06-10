const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { recordSignal, WEIGHTS } = require("../src/services/qualitySignals");

const TEMPLATE_ID = "11111111-1111-4111-8111-111111111111";

function createMockPool(initialScore = 0) {
  const state = {
    template: { id: TEMPLATE_ID, success_score: initialScore, status: "candidate" },
    signals: [],
    inTx: false,
  };

  function handleQuery(sql, params) {
    const norm = sql.replace(/\s+/g, " ").trim().toLowerCase();

    if (norm === "begin" || norm === "commit" || norm === "rollback") {
      if (norm === "begin") state.inTx = true;
      if (norm === "commit" || norm === "rollback") state.inTx = false;
      return { rows: [] };
    }

    if (norm.includes("select id from shared_templates where id")) {
      return state.template.id === params[0] ? { rows: [{ id: state.template.id }] } : { rows: [] };
    }

    if (norm.includes("from template_quality_signals") && norm.includes("interval")) {
      const [templateId, userKey, eventType] = params;
      const hit = state.signals.some(
        (s) => s.template_id === templateId && s.user_key === userKey && s.event_type === eventType
      );
      return { rows: hit ? [{ "1": 1 }] : [] };
    }

    if (norm.startsWith("insert into template_quality_signals")) {
      const [templateId, userKey, eventType, weight] = params;
      state.signals.push({ template_id: templateId, user_key: userKey, event_type: eventType, weight });
      return { rows: [] };
    }

    if (norm.includes("update shared_templates set success_score")) {
      const [weight, templateId] = params;
      if (state.template.id !== templateId) return { rows: [] };
      state.template.success_score = Number(state.template.success_score) + Number(weight);
      return {
        rows: [{ success_score: state.template.success_score, status: state.template.status }],
      };
    }

    if (norm.includes("update shared_templates set status = 'blocked'")) {
      if (state.template.id === params[0]) state.template.status = "blocked";
      return { rows: [] };
    }

    throw new Error(`unexpected query: ${sql}`);
  }

  const pool = {
    query: async (sql, params) => handleQuery(sql, params),
    connect: async () => ({
      query: async (sql, params) => handleQuery(sql, params),
      release() {},
    }),
  };

  return { pool, state };
}

describe("qualitySignals", () => {
  beforeEach(() => {
    delete process.env.TEMPLATE_BLOCK_THRESHOLD;
  });

  it("copy + save + like → success_score 10", async () => {
    const { pool, state } = createMockPool(0);
    for (const eventType of ["copy", "save", "like"]) {
      const result = await recordSignal(pool, {
        templateId: TEMPLATE_ID,
        eventType,
        userKey: "user-a",
      });
      assert.ok(!result.deduped);
    }
    assert.equal(state.template.success_score, WEIGHTS.copy + WEIGHTS.save + WEIGHTS.like);
    assert.equal(state.template.success_score, 10);
  });

  it("report_wrong twice → score -20 and status blocked", async () => {
    const { pool, state } = createMockPool(0);
    await recordSignal(pool, { templateId: TEMPLATE_ID, eventType: "report_wrong", userKey: "u1" });
    const second = await recordSignal(pool, {
      templateId: TEMPLATE_ID,
      eventType: "report_wrong",
      userKey: "u2",
    });
    assert.equal(state.template.success_score, -20);
    assert.equal(second.blocked, true);
    assert.equal(state.template.status, "blocked");
  });

  it("like twice same user/day → second call deduped", async () => {
    const { pool, state } = createMockPool(0);
    const first = await recordSignal(pool, {
      templateId: TEMPLATE_ID,
      eventType: "like",
      userKey: "fan-1",
    });
    const second = await recordSignal(pool, {
      templateId: TEMPLATE_ID,
      eventType: "like",
      userKey: "fan-1",
    });
    assert.ok(!first.deduped);
    assert.equal(second.deduped, true);
    assert.equal(state.template.success_score, WEIGHTS.like);
    assert.equal(state.signals.filter((s) => s.event_type === "like").length, 1);
  });

  it("template missing → notFound", async () => {
    const { pool } = createMockPool(0);
    const missing = "22222222-2222-4222-8222-222222222222";
    const result = await recordSignal(pool, {
      templateId: missing,
      eventType: "copy",
      userKey: "u",
    });
    assert.equal(result.notFound, true);
  });
});

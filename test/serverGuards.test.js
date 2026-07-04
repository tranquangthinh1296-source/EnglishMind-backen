const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { costGuard, COST_CAP_MESSAGE } = require("../src/middleware/costGuard");
const { appCheckMonitor } = require("../src/middleware/appCheck");
const { createUidLimiter } = require("../src/middleware/rateLimits");
const costEstimator = require("../src/services/costEstimator");
const { notifyOpsAlert } = require("../src/services/alertWebhook");

async function withServer(middleware, fn) {
  const app = express();
  app.use(express.json());
  app.post("/x", middleware, (_req, res) => res.json({ ok: true }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withWebhookServer(status, fn) {
  const received = [];
  const app = express();
  app.use(express.json());
  app.post("/hook", (req, res) => {
    received.push(req.body);
    res.sendStatus(status);
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}/hook`, received);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("server guards", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    costEstimator.__resetForTest();
  });

  it("costGuard returns 503 with the required Vietnamese message when cap is reached", async () => {
    process.env.COST_KILL_DAILY_USD = "0.01";
    const docs = new Map();
    const today = new Date().toISOString().slice(0, 10);
    docs.set(today, { dailyUsdEst: 0.02 });
    costEstimator.__setDailyStoreForTest({
      ref(date) {
        return {
          async get() {
            return { exists: docs.has(date), data: () => docs.get(date) };
          },
          async set(payload) {
            docs.set(date, { ...(docs.get(date) || {}), ...payload });
          },
        };
      },
    });

    await withServer(costGuard, async (base) => {
      const res = await fetch(`${base}/x`, { method: "POST" });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.errorCode, "cost_cap");
      assert.equal(body.errorMessage, COST_CAP_MESSAGE);
    });
  });

  it("uid limiter returns 429 on request 31 in a 5-minute AI window", async () => {
    process.env.RATE_AI_UID_5M = "30";
    const authStub = (req, _res, next) => {
      req.uid = "same-user";
      next();
    };
    const limiter = createUidLimiter("RATE_AI_UID_5M", 30);
    await withServer([authStub, limiter], async (base) => {
      let status = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await fetch(`${base}/x`, { method: "POST" });
        status = res.status;
      }
      assert.equal(status, 429);
    });
  });

  it("App Check default off calls next without verifying", async () => {
    delete process.env.APP_CHECK_MODE;
    let nextCalled = false;
    await appCheckMonitor({
      admin: {
        appCheck() {
          throw new Error("should_not_verify");
        },
      },
    })({ headers: {}, url: "/x" }, {}, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });

  it("posts ops alerts to ALERT_WEBHOOK_URL", async () => {
    await withWebhookServer(204, async (url, received) => {
      process.env.ALERT_WEBHOOK_URL = url;
      const result = await notifyOpsAlert("cost_alert", { dailyUsdEst: 2.5 });
      assert.equal(result.sent, true);
      assert.equal(received.length, 1);
      assert.equal(received[0].event, "cost_alert");
      assert.equal(received[0].service, "englishmind-server");
      assert.equal(received[0].dailyUsdEst, 2.5);
    });
  });

  it("fails soft when the ops alert webhook returns an error", async () => {
    await withWebhookServer(500, async (url) => {
      process.env.ALERT_WEBHOOK_URL = url;
      const result = await notifyOpsAlert("cost_cap", { dailyUsdEst: 5 });
      assert.equal(result.sent, false);
      assert.equal(result.status, 500);
    });
  });
});

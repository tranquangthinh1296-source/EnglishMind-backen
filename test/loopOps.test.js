const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const loopOps = require("../src/services/loopOpsStore");

function mockStore() {
  let doc = null;
  const docRef = {
    async get() {
      return { exists: !!doc, data: () => doc };
    },
    async set(data, opts) {
      if (opts && opts.merge && doc) doc = { ...doc, ...data };
      else doc = { ...data };
    },
  };
  const db = {
    doc: () => docRef,
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data, opts) {
          return ref.set(data, opts);
        },
      };
      await fn(tx);
    },
  };
  return { docRef, db };
}

async function withApp(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const loopRoutes = require("../src/routes/loopOps");
  const app = express();
  app.use(express.json());
  app.use("/api", loopRoutes);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = prev;
    delete require.cache[require.resolve("../src/routes/loopOps")];
  }
}

describe("loopOps routes", () => {
  beforeEach(() => {
    loopOps.setStoreForTest(mockStore());
  });
  afterEach(() => {
    loopOps.setStoreForTest(null);
  });

  it("rejects bridge sync without key", async () => {
    await withApp({ LOOP_BRIDGE_SECRET: "secret" }, async (base) => {
      const res = await fetch(`${base}/api/loop/bridge/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: { branch: "agent/test" } }),
      });
      assert.equal(res.status, 401);
    });
  });

  it("accepts bridge sync with valid key", async () => {
    await withApp({ LOOP_BRIDGE_SECRET: "secret" }, async (base) => {
      const res = await fetch(`${base}/api/loop/bridge/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Loop-Bridge-Key": "secret",
        },
        body: JSON.stringify({ status: { branch: "agent/test", tasks: { total: 1, done: 0, pending: 1 } } }),
      });
      const json = await res.json();
      assert.equal(res.status, 200);
      assert.equal(json.success, true);
    });
  });

  it("rejects admin command without token", async () => {
    await withApp({ LOOP_BRIDGE_SECRET: "secret" }, async (base) => {
      const res = await fetch(`${base}/api/admin/loop/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "chat", text: "hello" }),
      });
      assert.equal(res.status, 401);
    });
  });
});

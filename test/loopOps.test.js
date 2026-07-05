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

async function withApp(env, fn, opts = {}) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const loopRoutes = require("../src/routes/loopOps");
  const app = express();
  app.use(express.json());
  if (opts.admin) {
    app.use((req, _res, next) => {
      req.claims = { admin: true, uid: "test-admin" };
      next();
    });
  }
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

  it("passes release/health/structure snapshot fields through the status store", async () => {
    await loopOps.writeStatus({
      branch: "agent/test",
      release: {
        build: { versionCode: 7, versionName: "1.0.2-beta.7" },
        ota: { versionCode: 6, versionName: "1.0.2-beta.6" },
        drift: { otaBehindBuild: true, webServerMismatch: false },
        play: { track: "internal", reviewStatus: "not_submitted", checklistDone: 9, checklistTotal: 11 },
      },
      health: { backend: { ok: true, statusCode: 200, latencyMs: 42 } },
      structure: { modules: [{ id: "android", label: "Android app", path: "app/src", files: 321 }] },
      git: { hash: "abc1234", subject: "release: OTA manifest" },
    });
    const status = await loopOps.readStatus();
    assert.equal(status.release.build.versionCode, 7);
    assert.equal(status.release.drift.otaBehindBuild, true);
    assert.equal(status.release.play.checklistTotal, 11);
    assert.equal(status.health.backend.latencyMs, 42);
    assert.equal(status.structure.modules[0].files, 321);
    assert.equal(status.git.hash, "abc1234");
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

  it("returns command history with acked commands for admin status", async () => {
    const cmd = await loopOps.enqueueCommand({
      type: "stop",
      text: "Stop loop from web",
      payload: {},
      createdBy: "test-admin",
    });
    await loopOps.ackCommands([cmd.id], "done");

    await withApp({ LOOP_BRIDGE_SECRET: "secret" }, async (base) => {
      const res = await fetch(`${base}/api/admin/loop/status`);
      const json = await res.json();

      assert.equal(res.status, 200);
      assert.equal(json.success, true);
      assert.equal(json.data.pendingCommands.length, 0);
      assert.equal(json.data.commands.length, 1);
      assert.equal(json.data.commands[0].id, cmd.id);
      assert.equal(json.data.commands[0].status, "done");
      assert.ok(json.data.commands[0].ackedAt);
    }, { admin: true });
  });

  it("streams an authenticated loop snapshot event", async () => {
    await loopOps.writeStatus({ branch: "agent/live", tasks: { total: 2, done: 1, pending: 1 } });
    await loopOps.appendMessage({ role: "bridge", text: "sync OK" });

    await withApp({ LOOP_BRIDGE_SECRET: "secret" }, async (base) => {
      const ac = new AbortController();
      const res = await fetch(`${base}/api/admin/loop/stream`, { signal: ac.signal });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /text\/event-stream/);

      const reader = res.body.getReader();
      let text = "";
      while (!text.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString("utf8");
      }
      ac.abort();

      assert.match(text, /event: snapshot/);
      const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
      assert.ok(dataLine);
      const payload = JSON.parse(dataLine.slice("data: ".length));
      assert.equal(payload.status.branch, "agent/live");
      assert.equal(payload.messages[0].text, "sync OK");
      assert.deepEqual(payload.pendingCommands, []);
    }, { admin: true });
  });
});

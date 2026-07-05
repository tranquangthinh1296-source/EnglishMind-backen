const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const WebSocket = require("ws");

const firebasePath = require.resolve("../src/firebase");
const verifyAuthPath = require.resolve("../src/middleware/verifyAuth");
const planResolverPath = require.resolve("../src/middleware/planResolver");
const voiceLivePath = require.resolve("../src/routes/voiceLive");
const voiceQuotaPath = require.resolve("../src/services/voiceQuota");
const voiceStorePath = require.resolve("../src/services/voiceSessionStore");

function installFirebaseStub() {
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: {
      auth: {
        async verifyIdToken(token) {
          if (token === "pro-token") return { uid: "pro-user", plan: "pro" };
          if (token === "free-token") return { uid: "free-user", plan: "free" };
          throw new Error("bad token");
        },
      },
      db: {
        doc() {
          return {
            async get() {
              return { exists: false, get: () => null };
            },
          };
        },
      },
    },
  };
}

async function withVoiceServer({ env = {}, proxy = null, onServer = null } = {}, fn) {
  const previousEnv = { ...process.env };
  process.env = { ...previousEnv, ...env };
  delete require.cache[firebasePath];
  delete require.cache[verifyAuthPath];
  delete require.cache[planResolverPath];
  delete require.cache[voiceLivePath];
  delete require.cache[voiceQuotaPath];
  delete require.cache[voiceStorePath];
  installFirebaseStub();

  const { createVoiceLiveRoutes } = require("../src/routes/voiceLive");
  const routes = createVoiceLiveRoutes(proxy ? { geminiLiveProxy: proxy } : {});
  const app = express();
  app.use(express.json());
  app.use("/api", routes.router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  routes.attachUpgrade(server);
  if (typeof onServer === "function") onServer(server);
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, `ws://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    process.env = previousEnv;
    delete require.cache[firebasePath];
    delete require.cache[verifyAuthPath];
    delete require.cache[planResolverPath];
    delete require.cache[voiceLivePath];
    delete require.cache[voiceQuotaPath];
    delete require.cache[voiceStorePath];
  }
}

function authHeaders(token = "pro-token") {
  return {
    "Content-Type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function createSession(base, token = "pro-token", mode = "live_tutor") {
  return fetch(`${base}/api/voice/session`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ mode }),
  });
}

function waitForWsMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws_timeout")), 1500);
    socket.on("message", (data) => {
      const event = JSON.parse(data.toString());
      if (!predicate || predicate(event)) {
        clearTimeout(timer);
        resolve(event);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe("voice live routes", () => {
  afterEach(() => {
    process.env = { ...process.env };
  });

  it("keeps live session creation disabled by default with classic fallback", async () => {
    await withVoiceServer({}, async (base) => {
      const res = await createSession(base);
      const body = await res.json();
      assert.equal(res.status, 503);
      assert.equal(body.success, false);
      assert.equal(body.error, "voice_live_disabled");
      assert.equal(body.fallback, "classic");
    });
  });

  it("rejects session creation without auth", async () => {
    await withVoiceServer({ env: { VOICE_LIVE_ENABLED: "true" } }, async (base) => {
      const res = await fetch(`${base}/api/voice/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "live_tutor" }),
      });
      assert.equal(res.status, 401);
    });
  });

  it("blocks free users when the default live quota cap is zero", async () => {
    await withVoiceServer({ env: { VOICE_LIVE_ENABLED: "true" } }, async (base) => {
      const res = await createSession(base, "free-token");
      const body = await res.json();
      assert.equal(res.status, 429);
      assert.equal(body.error, "voice_quota_exceeded");
      assert.equal(body.fallback, "classic");
    });
  });

  it("rejects unsupported voice modes before feature checks", async () => {
    await withVoiceServer({ env: { VOICE_LIVE_ENABLED: "true" } }, async (base) => {
      const res = await createSession(base, "pro-token", "banana");
      const body = await res.json();
      assert.equal(res.status, 400);
      assert.equal(body.error, "unsupported_voice_mode");
      assert.equal(body.fallback, "classic");
    });
  });

  it("closes sessions with the backend close response contract", async () => {
    await withVoiceServer({
      env: { VOICE_LIVE_ENABLED: "true", VOICE_LIVE_DAILY_SECONDS_PRO: "300" },
    }, async (base) => {
      const create = await createSession(base);
      const session = await create.json();
      assert.equal(create.status, 200);

      const res = await fetch(`${base}/api/voice/session/${session.sessionId}/close`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ reason: "user_ended", clientDurationSeconds: 10 }),
      });
      const body = await res.json();

      assert.equal(res.status, 200);
      assert.equal(body.success, true);
      assert.equal(body.sessionId, session.sessionId);
      assert.equal(typeof body.chargedSeconds, "number");
      assert.equal(body.fallbackRecommended, false);
    });
  });

  it("emits classic fallback when the live proxy fails", async () => {
    const proxy = {
      connect() {
        throw new Error("mock upstream failed");
      },
    };
    await withVoiceServer({
      env: { VOICE_LIVE_ENABLED: "true", VOICE_LIVE_DAILY_SECONDS_PRO: "300" },
      proxy,
    }, async (base) => {
      const create = await createSession(base);
      const session = await create.json();
      assert.equal(create.status, 200);
      const socket = new WebSocket(session.websocketUrl);
      try {
        const event = await waitForWsMessage(socket, (msg) => msg.type === "error");
        assert.equal(event.code, "live_upstream_error");
        assert.equal(event.fallback, "classic");
      } finally {
        socket.close();
      }
    });
  });

  it("leaves non-voice websocket upgrades for other server handlers", async () => {
    const otherWss = new WebSocket.Server({ noServer: true });
    try {
      await withVoiceServer({
        onServer(server) {
          server.on("upgrade", (req, socket, head) => {
            const parsed = new URL(req.url, "http://localhost");
            if (parsed.pathname !== "/other-live") return;
            otherWss.handleUpgrade(req, socket, head, (ws) => {
              ws.send(JSON.stringify({ type: "other.ready" }));
              ws.close();
            });
          });
        },
      }, async (_base, wsBase) => {
        const socket = new WebSocket(`${wsBase}/other-live`);
        try {
          const event = await waitForWsMessage(socket);
          assert.equal(event.type, "other.ready");
        } finally {
          socket.close();
        }
      });
    } finally {
      otherWss.close();
    }
  });

  it("does not log audio input payloads while processing websocket messages", async () => {
    const sensitiveAudio = "BASE64_AUDIO_SHOULD_NOT_APPEAR";
    const logs = [];
    const original = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    console.log = (...args) => logs.push(args.join(" "));
    console.warn = (...args) => logs.push(args.join(" "));
    console.error = (...args) => logs.push(args.join(" "));

    const proxy = {
      connect() {
        return {
          send() {},
          close() {},
        };
      },
    };
    try {
      await withVoiceServer({
        env: { VOICE_LIVE_ENABLED: "true", VOICE_LIVE_DAILY_SECONDS_PRO: "300" },
        proxy,
      }, async (base) => {
        const create = await createSession(base);
        const session = await create.json();
        const socket = new WebSocket(session.websocketUrl);
        await new Promise((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        socket.send(JSON.stringify({
          type: "audio.input",
          seq: 1,
          mimeType: "audio/pcm;rate=16000",
          data: sensitiveAudio,
        }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        socket.close();
      });
    } finally {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }

    assert.equal(logs.join("\n").includes(sensitiveAudio), false);
  });
});

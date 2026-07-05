const express = require("express");
const WebSocket = require("ws");
const { verifyAuth } = require("../middleware/verifyAuth");
const { appCheckMonitor } = require("../middleware/appCheck");
const { createIpLimiter, createUidLimiter } = require("../middleware/rateLimits");
const voiceQuota = require("../services/voiceQuota");
const voiceSessionStore = require("../services/voiceSessionStore");
const voiceProtocol = require("../services/voiceProtocol");
const defaultGeminiLiveProxy = require("../services/geminiLiveProxy");

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase().trim() === "true";
}

function deployRegion() {
  return (
    process.env.RAILWAY_REGION ||
    process.env.DEPLOY_REGION ||
    process.env.RAILWAY_ENVIRONMENT_REGION ||
    "unknown"
  );
}

function errorBody(error) {
  return { success: false, error, fallback: "classic" };
}

function websocketUrlFor(req, sessionId) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").split(",")[0].trim();
  const httpProto = forwardedProto || req.protocol || "http";
  const wsProto = httpProto === "https" ? "wss" : "ws";
  const host = req.get("host");
  return `${wsProto}://${host}/api/voice/live?sessionId=${encodeURIComponent(sessionId)}`;
}

function isModeEnabled(mode) {
  if (!boolEnv("VOICE_LIVE_ENABLED", false)) return false;
  if (mode === "live_translate") return boolEnv("VOICE_LIVE_TRANSLATE_ENABLED", false);
  return mode === "live_tutor";
}

function parseClientDurationSeconds(req) {
  const raw = req.body && req.body.clientDurationSeconds;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

function createVoiceLiveRoutes(deps = {}) {
  const router = express.Router();
  const geminiLiveProxy = deps.geminiLiveProxy || defaultGeminiLiveProxy;
  const ipLimiter = deps.ipLimiter || createIpLimiter();
  const uidLimiter = deps.uidLimiter || createUidLimiter("RATE_VOICE_LIVE_UID_5M", 10);
  const store = deps.voiceSessionStore || voiceSessionStore;
  const quota = deps.voiceQuota || voiceQuota;
  const protocol = deps.voiceProtocol || voiceProtocol;

  router.get("/voice/status", (_req, res) => {
    res.json({
      success: true,
      liveEnabled: boolEnv("VOICE_LIVE_ENABLED", false),
      translateEnabled: boolEnv("VOICE_LIVE_TRANSLATE_ENABLED", false),
      provider: "gemini",
      region: deployRegion(),
    });
  });

  router.post(
    "/voice/session",
    ipLimiter,
    appCheckMonitor(),
    verifyAuth,
    uidLimiter,
    (req, res) => {
      const mode = req.body && req.body.mode;
      if (!protocol.VOICE_MODES.has(mode)) {
        return res.status(400).json(errorBody("unsupported_voice_mode"));
      }
      if (!isModeEnabled(mode)) {
        return res.status(503).json(errorBody("voice_live_disabled"));
      }

      const quotaResult = quota.canStart(req.uid, mode, req.plan || "free");
      if (!quotaResult.ok) {
        return res.status(429).json(errorBody("voice_quota_exceeded"));
      }

      const session = store.create({
        uid: req.uid,
        mode,
        maxSessionSeconds: quotaResult.maxSessionSeconds,
      });
      return res.json({
        success: true,
        sessionId: session.sessionId,
        websocketUrl: websocketUrlFor(req, session.sessionId),
        expiresAt: new Date(session.expiresAt).toISOString(),
        limits: {
          maxSessionSeconds: quotaResult.maxSessionSeconds,
          remainingSecondsToday: quotaResult.remainingSecondsToday,
        },
      });
    },
  );

  router.post("/voice/session/:id/close", verifyAuth, (req, res) => {
    const session = store.get(req.params.id);
    if (!session || session.uid !== req.uid) {
      return res.status(404).json(errorBody("voice_session_not_found"));
    }

    const serverElapsedSeconds = Math.max(0, Math.floor((Date.now() - session.createdAt) / 1000));
    const clientSeconds = parseClientDurationSeconds(req);
    const chargedSeconds = Math.min(
      clientSeconds === null ? serverElapsedSeconds : clientSeconds,
      serverElapsedSeconds,
      quota.maxSessionSeconds(),
    );
    const closed = store.close(session.sessionId, chargedSeconds);
    quota.recordSeconds(session.uid, session.mode, chargedSeconds);
    return res.json({
      success: true,
      sessionId: session.sessionId,
      chargedSeconds: closed ? closed.chargedSeconds : chargedSeconds,
      fallbackRecommended: false,
    });
  });

  function attachUpgrade(server) {
    const wss = new WebSocket.Server({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      let parsed;
      try {
        parsed = new URL(req.url, "http://localhost");
      } catch {
        socket.destroy();
        return;
      }
      if (parsed.pathname !== "/api/voice/live") {
        if (server.listenerCount("upgrade") > 1) return;
        socket.destroy();
        return;
      }

      const sessionId = parsed.searchParams.get("sessionId");
      const session = store.get(sessionId);
      if (!session) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, req, session);
      });
    });

    wss.on("connection", (client, _req, initialSession) => {
      let closed = false;
      let proxy = null;
      const maxMs = Math.max(1, initialSession.expiresAt - Date.now());
      const capTimer = setTimeout(() => {
        sendToClient(protocol.makeServerEvent("session.closed", {
          reason: "max_session_seconds",
          sessionId: initialSession.sessionId,
        }));
        closeBoth();
      }, maxMs);

      function sendToClient(event) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(event));
        }
      }

      function closeBoth() {
        if (closed) return;
        closed = true;
        clearTimeout(capTimer);
        if (proxy && typeof proxy.close === "function") proxy.close();
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.close();
        }
      }

      try {
        proxy = geminiLiveProxy.connect({
          mode: initialSession.mode,
          sessionId: initialSession.sessionId,
          onEvent(event) {
            sendToClient(event);
            if (event.type === "error" || event.type === "session.closed") {
              closeBoth();
            }
          },
        });
      } catch (e) {
        sendToClient(protocol.makeServerEvent("error", {
          code: "live_upstream_error",
          fallback: "classic",
        }));
        console.warn("[voice] live proxy unavailable");
        closeBoth();
        return;
      }

      sendToClient(protocol.makeServerEvent("session.ready", {
        sessionId: initialSession.sessionId,
        expiresAt: new Date(initialSession.expiresAt).toISOString(),
      }));

      client.on("message", (data) => {
        let event;
        try {
          event = JSON.parse(data.toString());
        } catch {
          sendToClient(protocol.makeServerEvent("error", {
            code: "invalid_event",
            fallback: "classic",
          }));
          return;
        }

        const session = store.get(initialSession.sessionId);
        const validation = protocol.validateClientEvent(event, session);
        if (!validation.ok) {
          sendToClient(protocol.makeServerEvent("error", {
            code: validation.error,
            fallback: "classic",
          }));
          return;
        }

        if (event.type === "session.end") {
          sendToClient(protocol.makeServerEvent("session.closed", {
            reason: "client_ended",
            sessionId: initialSession.sessionId,
          }));
          closeBoth();
          return;
        }

        if (proxy && typeof proxy.send === "function") proxy.send(event);
      });

      client.on("close", closeBoth);
      client.on("error", closeBoth);
    });
  }

  return { router, attachUpgrade };
}

const defaultRoutes = createVoiceLiveRoutes();

module.exports = {
  ...defaultRoutes,
  createVoiceLiveRoutes,
};

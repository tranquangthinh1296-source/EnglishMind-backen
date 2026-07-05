// EnglishMind backend entrypoint.
// Routes:
//   POST /api/ai/generate          → Pro AI proxy (verify token + quota + Gemini; incl. speaking_pack_generation)
//   GET  /api/trial-status/:id      → signed trial status
//   GET  /api/curricula, /lesson/:id, /vocabulary, /word/:w, /v1/tower/...  → content (proxied)
//   POST /api/progress, /api/lesson → content writes (proxied)
//   GET  /health                    → Beta Ops health ({ok, service, env} — BetaOpsClient)
//   POST /v1/feedback, /v1/bug-report, /v1/event,
//        /v1/ai/can-use, /v1/ai/record-usage → Beta Ops (B1, beta-key auth, PostgreSQL)
//   GET  /healthz                   → health check
//   GET  /static/voice-packs/*      → OTA voice pack zips (VOICE-PACK-1D, no Firebase Storage)
//   GET  /static/app/manifest.json  → beta APK OTA manifest (APP-UPDATE-1)
//   GET  /static/app/app-debug.apk    → beta debug APK sideload OTA
//   GET  /api/stt/status            → STT enabled/configured (public metadata)
//   POST /api/billing/verify        → Play purchase verify → Firestore tier (PAYMENTS-SECURITY-1)
//   POST /api/stt/transcribe        → whisper.cpp server-side STT (VOICE-STT-SERVER-1)
// Load .env locally if dotenv is present; on Railway env vars are injected.
try { require("dotenv").config(); } catch { /* dotenv optional */ }

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const aiRoutes = require("./routes/ai");
const sttRoutes = require("./routes/stt"); // VOICE-STT-SERVER-1: whisper.cpp server-side
const voicePackRoutes = require("./routes/voicePack"); // VOICE-PACK-1D
const voiceLiveRoutes = require("./routes/voiceLive");
const adminDiagnosticsRoutes = require("./routes/adminDiagnostics");
const loopOpsRoutes = require("./routes/loopOps");
const opsTrackRoutes = require("./routes/opsTrack");
const contentRoutes = require("./routes/content");
const trialRoutes = require("./routes/trial");
const billingRoutes = require("./routes/billing");
const betaOpsRoutes = require("./routes/betaOps");
const { createAccountRouter } = require("./routes/account");
const costEstimator = require("./services/costEstimator");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());

// EnglishMind Web (Next.js) calls this API directly from the browser — Android never needed CORS
// since it isn't a browser. Origins are env-driven so adding/changing the web deployment domain
// doesn't need a code change. WEB_ALLOWED_ORIGINS is a comma-separated list, e.g.
// "https://englishmind.app,https://englishmind-web.up.railway.app".
const webAllowedOrigins = (process.env.WEB_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (webAllowedOrigins.length === 0) {
  console.warn(
    "[cors] WEB_ALLOWED_ORIGINS empty — browser web clients will get Failed to fetch. " +
      "Set e.g. http://localhost:3000,https://englishmind.app on Railway.",
  );
}
app.use(
  cors({
    origin: webAllowedOrigins.length > 0 ? webAllowedOrigins : false,
    credentials: false,
  }),
);

// Beta Ops mounts BEFORE the global 2mb parser so its own 64kb limit applies to /v1.
app.use(betaOpsRoutes);

app.use(express.json({ limit: "2mb" }));

// Health check (Railway / uptime probes).
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Voice pack OTA files — served from repo (Spark-safe; no Firebase Storage / Blaze).
app.use(
  "/static",
  express.static(path.join(__dirname, "../public"), {
    index: false,
    etag: true,
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }),
);

// All app endpoints are namespaced under /api.
app.use("/api", aiRoutes);
app.use("/api", opsTrackRoutes);
app.use("/api", sttRoutes);
app.use("/api", voicePackRoutes);
app.use("/api", voiceLiveRoutes.router);
app.use("/api", adminDiagnosticsRoutes);
app.use("/api", loopOpsRoutes);
app.use("/api", trialRoutes);
app.use("/api", billingRoutes);
app.use("/api", createAccountRouter());
app.use("/api", contentRoutes);

// 404 fallback.
app.use((req, res) => {
  res.status(404).json({ success: false, error: "not_found", path: req.originalUrl });
});

// Error fallback.
app.use((err, _req, res, _next) => {
  console.error("[unhandled]", err);
  res.status(500).json({ success: false, error: "internal_error" });
});

const PORT = process.env.PORT || 8080;
const SHUTDOWN_GRACE_MS = Number(process.env.SHUTDOWN_GRACE_MS || 25_000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`EnglishMind backend listening on 0.0.0.0:${PORT}`);
});

voiceLiveRoutes.attachUpgrade(server);

costEstimator.restoreDailyCostFromFirestore().catch(() => {});

function shutdown(signal) {
  console.log(JSON.stringify({ event: "shutdown", signal }));
  server.close((err) => {
    if (err) console.error("[shutdown] server.close error", err.message || err);
    process.exit(err ? 1 : 0);
  });
  setTimeout(() => {
    console.error("[shutdown] forced exit after grace timeout");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

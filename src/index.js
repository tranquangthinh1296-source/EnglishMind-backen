// EnglishMind backend entrypoint.
// Routes:
//   POST /api/ai/generate          → Pro AI proxy (verify token + quota + Gemini)
//   GET  /api/trial-status/:id      → signed trial status
//   GET  /api/curricula, /lesson/:id, /vocabulary, /word/:w, /v1/tower/...  → content (proxied)
//   POST /api/progress, /api/lesson → content writes (proxied)
//   GET  /health                    → Beta Ops health ({ok, service, env} — BetaOpsClient)
//   POST /v1/feedback, /v1/bug-report, /v1/event,
//        /v1/ai/can-use, /v1/ai/record-usage → Beta Ops (B1, beta-key auth, PostgreSQL)
//   GET  /healthz                   → health check
//   GET  /static/voice-packs/*      → OTA voice pack zips (VOICE-PACK-1D, no Firebase Storage)
// Load .env locally if dotenv is present; on Railway env vars are injected.
try { require("dotenv").config(); } catch { /* dotenv optional */ }

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const aiRoutes = require("./routes/ai");
const sttRoutes = require("./routes/stt"); // VOICE-STT-SERVER-1 (Q6): whisper.cpp server-side, default OFF
const voicePackRoutes = require("./routes/voicePack"); // VOICE-PACK-1D
const adminDiagnosticsRoutes = require("./routes/adminDiagnostics");
const contentRoutes = require("./routes/content");
const trialRoutes = require("./routes/trial");
const betaOpsRoutes = require("./routes/betaOps");

const app = express();
app.use(helmet());

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
app.use("/api", sttRoutes);
app.use("/api", voicePackRoutes);
app.use("/api", adminDiagnosticsRoutes);
app.use("/api", trialRoutes);
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

const server = app.listen(PORT, () => {
  console.log(`EnglishMind backend listening on :${PORT}`);
});

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

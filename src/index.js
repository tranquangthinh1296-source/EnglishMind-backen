// EnglishMind backend entrypoint.
// Routes:
//   POST /api/ai/generate          → Pro AI proxy (verify token + quota + Gemini)
//   GET  /api/trial-status/:id      → signed trial status
//   GET  /api/curricula, /lesson/:id, /vocabulary, /word/:w, /v1/tower/...  → content (proxied)
//   POST /api/progress, /api/lesson → content writes (proxied)
//   GET  /healthz                   → health check
// Load .env locally if dotenv is present; on Railway env vars are injected.
try { require("dotenv").config(); } catch { /* dotenv optional */ }

const express = require("express");
const aiRoutes = require("./routes/ai");
const contentRoutes = require("./routes/content");
const trialRoutes = require("./routes/trial");

const app = express();
app.use(express.json({ limit: "2mb" }));

// Health check (Railway / uptime probes).
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// All app endpoints are namespaced under /api.
app.use("/api", aiRoutes);
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
app.listen(PORT, () => {
  console.log(`EnglishMind backend listening on :${PORT}`);
});

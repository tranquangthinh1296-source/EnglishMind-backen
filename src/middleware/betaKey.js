// Beta Ops auth (Q2 decision): /v1/feedback, /v1/bug-report, /v1/event and the
// device-level AI guard use the shared X-EnglishMind-Beta-Key header so they work
// before sign-in. /api/ai/generate keeps Firebase ID token auth (verifyAuth.js).
const crypto = require("crypto");

function constantTimeEquals(a, b) {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = function betaKey(req, res, next) {
  const expected = (process.env.BETA_OPS_KEY || "").trim();
  if (expected.length < 24) {
    // Matches BetaOpsClient.isConfigured(): keys shorter than 24 chars are invalid.
    return res.status(503).json({ ok: false, error: "beta_ops_not_configured" });
  }
  const provided = req.get("X-EnglishMind-Beta-Key") || "";
  if (!constantTimeEquals(provided, expected)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
};

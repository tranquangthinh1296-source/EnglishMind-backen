const express = require("express");
const rateLimit = require("express-rate-limit");
const { verifyAuth } = require("../middleware/verifyAuth");
const opsMetrics = require("../services/opsMetrics");

const router = express.Router();

router.use(
  "/ops/track",
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.WEB_OPS_TRACK_RATE_LIMIT || 120),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "rate_limited" },
  }),
);

router.post("/ops/track", verifyAuth, async (req, res) => {
  const eventType = req.body && req.body.eventType;
  const meta = (req.body && req.body.meta) || {};
  if (!eventType || typeof eventType !== "string") {
    return res.status(400).json({ success: false, error: "invalid_event" });
  }
  const ok = await opsMetrics.recordWebEvent(eventType, meta, { uid: req.uid });
  if (!ok) {
    return res.status(400).json({ success: false, error: "event_not_allowed" });
  }
  return res.json({ success: true });
});

module.exports = router;

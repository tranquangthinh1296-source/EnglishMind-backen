const express = require("express");
const { auth, db } = require("../firebase");
const { serverDay } = require("../middleware/checkQuota");

const router = express.Router();

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length ? token : null;
}

router.get("/admin/ai-diagnostics", async (req, res) => {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: "missing_token" });
  }
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    return res.status(401).json({ success: false, error: "invalid_token" });
  }
  if (decoded.admin !== true) {
    return res.status(403).json({ success: false, error: "forbidden" });
  }

  const today = serverDay();
  try {
    const snap = await db.collectionGroup("days").where("date", "==", today).limit(500).get();
    let callsToday = 0;
    let unitsUsedToday = 0;
    let quotaBlockedCount = 0;
    let upstreamErrorCount = 0;
    let cacheHits = 0;
    let cacheMisses = 0;
    const callsByPlan = {};
    const userUnits = {};

    snap.forEach((doc) => {
      const d = doc.data() || {};
      callsToday += d.calls || 0;
      unitsUsedToday += d.unitsUsed || 0;
      quotaBlockedCount += d.quotaBlockedCount || 0;
      upstreamErrorCount += d.upstreamErrorCount || 0;
      cacheHits += d.cacheHits || 0;
      cacheMisses += d.cacheMisses || 0;
      const plan = d.plan || "unknown";
      callsByPlan[plan] = (callsByPlan[plan] || 0) + (d.calls || 0);
      const uid = doc.ref.parent.parent.id;
      userUnits[uid] = (userUnits[uid] || 0) + (d.unitsUsed || 0);
    });

    const topUsersByUnits = Object.entries(userUnits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([uid, units]) => ({ uid, units }));

    const totalCache = cacheHits + cacheMisses;
    return res.json({
      success: true,
      data: {
        callsToday,
        unitsUsedToday,
        estimatedCostToday: unitsUsedToday,
        callsByPlan,
        topUsersByUnits,
        quotaBlockedCount,
        upstreamErrorCount,
        cacheHitRate: totalCache > 0 ? cacheHits / totalCache : 0,
      },
    });
  } catch (e) {
    console.error("[admin/ai-diagnostics]", e.message);
    return res.status(503).json({ success: false, error: "diagnostics_unavailable" });
  }
});

module.exports = router;

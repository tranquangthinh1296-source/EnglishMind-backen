const express = require("express");
const { auth, db } = require("../firebase");
const { serverDay } = require("../middleware/checkQuota");
const { requireAdmin } = require("../middleware/requireAdmin");
const gatewayStats = require("../services/gatewayStats");
const costEstimator = require("../services/costEstimator");
const opsMetrics = require("../services/opsMetrics");
const { MODEL, PRIMARY_MODEL, FALLBACK_MODEL } = require("../gemini");

const router = express.Router();

function deployRegion() {
  return (
    process.env.RAILWAY_REGION ||
    process.env.DEPLOY_REGION ||
    process.env.RAILWAY_ENVIRONMENT_REGION ||
    "unknown"
  );
}

async function aggregateQuotaToday() {
  const today = serverDay();
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
    .map(([uid, units]) => ({
      uidSuffix: uid.slice(-8),
      units,
    }));

  const totalCache = cacheHits + cacheMisses;
  return {
    callsToday,
    unitsUsedToday,
    callsByPlan,
    topUsersByUnits,
    quotaBlockedCount,
    upstreamErrorCount,
    cacheHitRate: totalCache > 0 ? cacheHits / totalCache : 0,
  };
}

function countMapKeys(value) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function countEvents(events = {}) {
  return Object.values(events).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function surfaceSummary(rollup, key) {
  const surface = (((rollup || {}).web || {}).surfaces || {})[key] || {};
  const events = surface.events || {};
  return {
    visitors: countMapKeys(surface.visitors),
    pageViews: Number(events.web_page_view || 0),
    interactions:
      Number(events.web_tool_open || 0) +
      Number(events.web_cta_click || 0) +
      Number(events.web_scroll_depth || 0) +
      Number(events.web_brain_save || 0) +
      Number(events.web_ai_submit || 0),
    aiSubmits: countEvents(surface.aiByTask || {}),
    ctaClicks: countEvents(surface.ctas || {}),
    leads: Number(events.web_lead_submit || 0),
    pages: surface.pages || {},
    tools: surface.tools || {},
    ctas: surface.ctas || {},
  };
}

async function aggregateAcquisitionLeads() {
  try {
    const snap = await db.collection("acquisitionLeads").limit(500).get();
    let total = 0;
    const recent = [];
    snap.forEach((doc) => {
      total += 1;
      const d = doc.data() || {};
      const email = String(d.email || "");
      const maskedEmail = email.includes("@")
        ? `${email.slice(0, 2)}***@${email.split("@").pop()}`
        : "";
      if (recent.length < 10) {
        recent.push({
          idSuffix: doc.id.slice(-6),
          email: maskedEmail,
          org: String(d.org || "").slice(0, 80),
          createdAt: d.createdAt && typeof d.createdAt.toDate === "function" ? d.createdAt.toDate().toISOString() : null,
        });
      }
    });
    return { total, recent };
  } catch (e) {
    console.error("[admin/acquisitionLeads]", e.message);
    return { total: 0, recent: [], unavailable: true };
  }
}

router.get("/admin/ai-diagnostics", requireAdmin, async (_req, res) => {
  try {
    const data = await aggregateQuotaToday();
    return res.json({
      success: true,
      data: {
        ...data,
        estimatedCostToday: data.unitsUsedToday,
      },
    });
  } catch (e) {
    console.error("[admin/ai-diagnostics]", e.message);
    return res.status(503).json({ success: false, error: "diagnostics_unavailable" });
  }
});

router.get("/admin/overview", requireAdmin, async (_req, res) => {
  try {
    const [quota, rollup, gateway, cost, acquisitionLeads] = await Promise.all([
      aggregateQuotaToday(),
      opsMetrics.readDaily(),
      Promise.resolve(gatewayStats.snapshot()),
      Promise.resolve(costEstimator.snapshot()),
      aggregateAcquisitionLeads(),
    ]);

    return res.json({
      success: true,
      data: {
        date: serverDay(),
        quota,
        rollup,
        sites: {
          webLite: surfaceSummary(rollup, "web-lite"),
          webAcquire: {
            ...surfaceSummary(rollup, "web-acquire"),
            leadsTotal: acquisitionLeads.total,
            recentLeads: acquisitionLeads.recent,
            leadsUnavailable: acquisitionLeads.unavailable === true,
          },
        },
        gateway: {
          ...gateway,
          model: MODEL,
          primaryModel: PRIMARY_MODEL,
          fallbackModel: FALLBACK_MODEL,
          region: deployRegion(),
        },
        cost,
        costAlertUsd: Number(process.env.COST_ALERT_DAILY_USD) || null,
      },
    });
  } catch (e) {
    console.error("[admin/overview]", e.message);
    return res.status(503).json({ success: false, error: "overview_unavailable" });
  }
});

router.get("/admin/health", requireAdmin, async (_req, res) => {
  const gateway = gatewayStats.snapshot();
  const cost = costEstimator.snapshot();
  return res.json({
    success: true,
    data: {
      ok: true,
      service: "englishmind-ai-gateway",
      region: deployRegion(),
      gateway,
      cost,
      quotaTimeoutMs: parseInt(process.env.AI_QUOTA_TIMEOUT_MS || "5000", 10),
    },
  });
});

router.get("/admin/users/summary", requireAdmin, async (_req, res) => {
  try {
    const list = await auth.listUsers(1000);
    let anonymous = 0;
    let email = 0;
    let adminCount = 0;
    for (const u of list.users) {
      if (u.customClaims && u.customClaims.admin === true) adminCount += 1;
      const providerIds = (u.providerData || []).map((p) => p.providerId);
      if (providerIds.includes("password") || providerIds.includes("google.com")) {
        email += 1;
      } else if (providerIds.length === 0 || u.providerData.length === 0) {
        anonymous += 1;
      } else {
        email += 1;
      }
    }
    return res.json({
      success: true,
      data: {
        sampled: list.users.length,
        anonymous,
        email,
        adminCount,
        hasMore: !!list.pageToken,
      },
    });
  } catch (e) {
    console.error("[admin/users/summary]", e.message);
    return res.status(503).json({ success: false, error: "users_summary_unavailable" });
  }
});

module.exports = router;

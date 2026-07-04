// Daily ops rollup in Firestore — §16-safe aggregates for owner admin dashboard.
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("crypto");
const { db } = require("../firebase");
const { serverDay } = require("../middleware/checkQuota");

const ALLOWED_WEB_EVENTS = new Set([
  "web_page_view",
  "web_tool_open",
  "web_brain_save",
  "web_ai_submit",
  "web_auth_upgrade",
  "web_cta_click",
  "web_scroll_depth",
  "web_lead_submit",
]);

const ALLOWED_META_KEYS = new Set(["page", "tool", "task_type", "success", "method", "platform", "cta", "depth"]);

function sanitizeKey(value) {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 48);
}

function normalizePlatform(raw) {
  const p = String(raw || "").toLowerCase().trim();
  if (p === "web" || p === "android") return p;
  return "unknown";
}

function normalizeWebSurface(raw) {
  const p = String(raw || "").toLowerCase().trim();
  if (p === "web-acquire" || p === "web_lite" || p === "web-lite") {
    return p.replace("_", "-");
  }
  return "web-lite";
}

function hashUserKey(uid) {
  if (!uid) return null;
  return crypto.createHash("sha256").update(String(uid)).digest("hex").slice(0, 16);
}

function dailyRef(date = serverDay()) {
  return db.doc(`opsMetrics/daily/${date}`);
}

async function mergeIncrement(updates) {
  try {
    await dailyRef().set(
      {
        date: serverDay(),
        updatedAt: Date.now(),
        ...updates,
      },
      { merge: true },
    );
  } catch (e) {
    console.error("[opsMetrics] merge failed:", e.message);
  }
}

function incField(path, delta = 1) {
  return { [path]: FieldValue.increment(delta) };
}

async function recordWebEvent(eventType, meta = {}, actor = {}) {
  if (!ALLOWED_WEB_EVENTS.has(eventType)) return false;
  const safe = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED_META_KEYS.has(k)) continue;
    safe[k] = String(v).slice(0, 80);
  }

  const surface = normalizeWebSurface(safe.platform);
  const userKey = hashUserKey(actor.uid);
  const updates = {
    ...incField(`web.events.${eventType}`, 1),
    ...incField(`web.surfaces.${surface}.events.${eventType}`, 1),
  };
  if (userKey) {
    updates[`web.surfaces.${surface}.visitors.${userKey}`] = true;
  }
  if (eventType === "web_page_view" && safe.page) {
    Object.assign(updates, incField(`web.pages.${sanitizeKey(safe.page)}`, 1));
    Object.assign(updates, incField(`web.surfaces.${surface}.pages.${sanitizeKey(safe.page)}`, 1));
  }
  if (eventType === "web_tool_open" && safe.tool) {
    Object.assign(updates, incField(`web.tools.${sanitizeKey(safe.tool)}`, 1));
    Object.assign(updates, incField(`web.surfaces.${surface}.tools.${sanitizeKey(safe.tool)}`, 1));
  }
  if (eventType === "web_cta_click" && safe.cta) {
    Object.assign(updates, incField(`web.ctas.${sanitizeKey(safe.cta)}`, 1));
    Object.assign(updates, incField(`web.surfaces.${surface}.ctas.${sanitizeKey(safe.cta)}`, 1));
  }
  if (eventType === "web_scroll_depth" && safe.depth) {
    Object.assign(updates, incField(`web.scrollDepth.${sanitizeKey(safe.depth)}`, 1));
    Object.assign(updates, incField(`web.surfaces.${surface}.scrollDepth.${sanitizeKey(safe.depth)}`, 1));
  }
  if (eventType === "web_ai_submit") {
    Object.assign(updates, incField("web.aiSubmits", 1));
    if (safe.success === "true") {
      Object.assign(updates, incField("web.aiSubmitSuccess", 1));
    }
    if (safe.task_type) {
      Object.assign(updates, incField(`web.aiByTask.${sanitizeKey(safe.task_type)}`, 1));
      Object.assign(updates, incField(`web.surfaces.${surface}.aiByTask.${sanitizeKey(safe.task_type)}`, 1));
    }
  }
  await mergeIncrement(updates);
  return true;
}

async function recordAiCall({
  platform = "unknown",
  taskType = "unknown",
  success = false,
  estCostUsd = 0,
  errorCode = null,
}) {
  const plat = normalizePlatform(platform);
  const task = sanitizeKey(taskType);
  const updates = {
    ...incField(`platforms.${plat}.aiCalls`, 1),
    ...incField("ai.totalCalls", 1),
    ...incField(`ai.byTask.${task}`, 1),
  };
  if (success) {
    Object.assign(updates, incField("ai.successCalls", 1));
  }
  if (estCostUsd > 0) {
    Object.assign(updates, incField("ai.estCostUsd", estCostUsd));
  }
  if (errorCode === "quota_exceeded") {
    Object.assign(updates, incField("quota.blockedCount", 1));
  }
  if (errorCode === "ai_upstream_error") {
    Object.assign(updates, incField("ai.upstreamErrors", 1));
  }
  await mergeIncrement(updates);
}

async function recordPolicyBlock(taskType = "unknown", platform = "unknown") {
  const plat = normalizePlatform(platform);
  const task = sanitizeKey(taskType);
  await mergeIncrement({
    ...incField("ai.policyBlocked", 1),
    ...incField(`ai.policyBlockedByTask.${task}`, 1),
    ...incField(`platforms.${plat}.policyBlocked`, 1),
  });
}

async function recordQuotaUnavailable() {
  await mergeIncrement(incField("quota.unavailableCount", 1));
}

async function recordAppCheckFailure(mode = "log") {
  await mergeIncrement({
    ...incField("security.appCheckFailures", 1),
    ...incField(`security.appCheckFailuresByMode.${sanitizeKey(mode)}`, 1),
  });
}

async function recordLegacySystemInstruction(taskType = "unknown") {
  await mergeIncrement({
    ...incField("ai.legacySystemInstruction", 1),
    ...incField(`ai.legacySystemInstructionByTask.${sanitizeKey(taskType)}`, 1),
  });
}

async function readDaily(date = serverDay()) {
  const snap = await db.doc(`opsMetrics/daily/${date}`).get();
  return snap.exists ? snap.data() : { date, empty: true };
}

module.exports = {
  ALLOWED_WEB_EVENTS,
  ALLOWED_META_KEYS,
  sanitizeKey,
  normalizePlatform,
  recordWebEvent,
  recordAiCall,
  recordPolicyBlock,
  recordQuotaUnavailable,
  recordAppCheckFailure,
  recordLegacySystemInstruction,
  readDaily,
};

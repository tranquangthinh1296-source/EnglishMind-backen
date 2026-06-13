// Beta Ops Control Center (task B1) — PLATFORM_SPEC.md §8, §11.1-11.4.
// Contract mirrors the shipped Android client (BetaOpsClient.kt): camelCase JSON,
// X-EnglishMind-Beta-Key header, GET /health → {ok, service, env}, writes → {ok, id}.
// Security rules (§8.4): zod-validate every input, never log request bodies,
// no stacktraces in responses, rate limiting on all /v1 routes.
const express = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const betaKey = require("../middleware/betaKey");
const { isDbConfigured, getPool, ensureBetaOpsSchema, ensureWarehouseSchema } = require("../db");
const { recordSignal } = require("../services/qualitySignals");
const { notifyFeedbackInstant, sendFeedbackDigest } = require("../services/feedbackNotify");

const router = express.Router();

// --- /health (root level — BetaOpsClient expects /health, /healthz stays for Railway) ---
router.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "englishmind-beta-ops",
    env: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "dev",
    region:
      process.env.RAILWAY_REGION ||
      process.env.DEPLOY_REGION ||
      process.env.RAILWAY_ENVIRONMENT_REGION ||
      "unknown",
  });
});

// --- /v1 middleware chain: body limit → rate limit → auth ---
router.use("/v1", express.json({ limit: "64kb" }));
router.use(
  "/v1",
  rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.BETA_OPS_RATE_LIMIT || 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "rate_limited" },
  })
);
router.use("/v1", betaKey);

// --- Validation schemas (zod) ---
const deviceFields = {
  appVersion: z.string().max(40).optional(),
  androidVersion: z.string().max(40).optional(),
  deviceModel: z.string().max(80).optional(),
  deviceHash: z.string().max(128).optional(),
};

const feedbackSchema = z.object({
  ...deviceFields,
  category: z.enum(["bug", "idea", "content", "other"]),
  message: z.string().min(3).max(4000),
  contact: z.string().max(200).optional(),
});

const bugReportSchema = z.object({
  ...deviceFields,
  screenName: z.string().max(120).optional(),
  featureName: z.string().max(120).optional(),
  errorType: z.string().max(120).optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).default("warning"),
  safeMessage: z.string().max(2000).optional(),
});

const eventSchema = z.object({
  ...deviceFields,
  eventType: z.string().min(1).max(60),
  featureName: z.string().max(120).optional(),
  safeMetadata: z
    .record(z.string(), z.unknown())
    .optional()
    .refine((m) => m === undefined || JSON.stringify(m).length <= 4000, {
      message: "safeMetadata too large",
    }),
});

const usageSchema = z.object({
  deviceHash: z.string().min(8).max(128),
  appVersion: z.string().max(40).optional(),
});

const templateSignalSchema = z
  .object({
    templateId: z.string().uuid(),
    eventType: z.enum([
      "copy",
      "save",
      "like",
      "reuse",
      "edit_after_generate",
      "report_wrong",
    ]),
    userKey: z.string().max(128).optional(),
  })
  .superRefine((data, ctx) => {
    if ((data.eventType === "like" || data.eventType === "save") && !data.userKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "userKey required for like/save",
        path: ["userKey"],
      });
    }
  });

function parseBody(schema, req, res) {
  const result = schema.safeParse(req.body || {});
  if (!result.success) {
    // §8.4: never echo the raw body back or into logs.
    res.status(400).json({ ok: false, error: "invalid_input" });
    return null;
  }
  return result.data;
}

async function withDb(res, fn, onUnavailable) {
  if (!isDbConfigured()) return onUnavailable();
  try {
    await ensureBetaOpsSchema();
    return await fn(getPool());
  } catch (err) {
    console.error("[betaOps] db error:", err.code || err.message);
    return onUnavailable();
  }
}

// Server-day string (YYYY-MM-DD) in quota timezone — same convention as checkQuota.js.
function serverDay() {
  const tz = process.env.QUOTA_TIMEZONE || "Asia/Ho_Chi_Minh";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

// --- POST /v1/feedback (§11.1) ---
router.post("/v1/feedback", async (req, res) => {
  const data = parseBody(feedbackSchema, req, res);
  if (!data) return;
  await withDb(
    res,
    async (pool) => {
      const { rows } = await pool.query(
        `INSERT INTO beta_feedback (app_version, android_version, device_model, device_hash, category, message, contact)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, created_at, app_version, android_version, device_model, device_hash, category, message, contact`,
        [data.appVersion, data.androidVersion, data.deviceModel, data.deviceHash, data.category, data.message, data.contact]
      );
      const row = rows[0];
      notifyFeedbackInstant(row);
      res.status(201).json({ ok: true, id: row.id });
    },
    () => res.status(503).json({ ok: false, error: "storage_unavailable" })
  );
});

// --- POST /v1/bug-report (§11.2) ---
router.post("/v1/bug-report", async (req, res) => {
  const data = parseBody(bugReportSchema, req, res);
  if (!data) return;
  await withDb(
    res,
    async (pool) => {
      const { rows } = await pool.query(
        `INSERT INTO beta_bug_report (app_version, android_version, device_model, device_hash, screen_name, feature_name, error_type, severity, safe_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [data.appVersion, data.androidVersion, data.deviceModel, data.deviceHash, data.screenName, data.featureName, data.errorType, data.severity, data.safeMessage]
      );
      res.status(201).json({ ok: true, id: rows[0].id });
    },
    () => res.status(503).json({ ok: false, error: "storage_unavailable" })
  );
});

// --- POST /v1/event (§11.4) ---
router.post("/v1/event", async (req, res) => {
  const data = parseBody(eventSchema, req, res);
  if (!data) return;
  await withDb(
    res,
    async (pool) => {
      const { rows } = await pool.query(
        `INSERT INTO beta_event_log (app_version, android_version, device_model, device_hash, event_type, feature_name, safe_metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [data.appVersion, data.androidVersion, data.deviceModel, data.deviceHash, data.eventType, data.featureName, data.safeMetadata ? JSON.stringify(data.safeMetadata) : null]
      );
      res.status(201).json({ ok: true, id: rows[0].id });
    },
    () => res.status(503).json({ ok: false, error: "storage_unavailable" })
  );
});

// --- POST /v1/template-signal (§11.8, B3) ---
router.post("/v1/template-signal", async (req, res) => {
  const data = parseBody(templateSignalSchema, req, res);
  if (!data) return;
  await withDb(
    res,
    async (pool) => {
      await ensureWarehouseSchema();
      const result = await recordSignal(pool, {
        templateId: data.templateId,
        eventType: data.eventType,
        userKey: data.userKey,
      });
      if (result.notFound) {
        return res.status(404).json({ ok: false, error: "template_not_found" });
      }
      const body = { ok: true };
      if (result.deduped) body.deduped = true;
      res.json(body);
    },
    () => res.status(503).json({ ok: false, error: "storage_unavailable" })
  );
});

// --- POST /v1/admin/feedback-digest — owner inbox (Railway Cron + Beta-Key). ---
router.post("/v1/admin/feedback-digest", async (req, res) => {
  const hours = req.body?.hours;
  await withDb(
    res,
    async (pool) => {
      try {
        const result = await sendFeedbackDigest(pool, hours);
        if (!result.sent) {
          return res.json({ ok: true, ...result });
        }
        res.json({ ok: true, ...result });
      } catch (err) {
        console.error("[betaOps] feedback digest email failed:", err.message);
        res.status(500).json({ ok: false, error: "email_failed" });
      }
    },
    () => res.status(503).json({ ok: false, error: "storage_unavailable" })
  );
});

// --- POST /v1/ai/can-use (§11.3) — device-level daily guard. Fail-OPEN when DB is
// down: beta users must not be blocked by ops issues (client still has local quota
// plus the server-side Firestore quota on /api/ai/generate as the hard stop). ---
router.post("/v1/ai/can-use", async (req, res) => {
  const data = parseBody(usageSchema, req, res);
  if (!data) return;
  const limit = Number(process.env.BETA_DAILY_AI_LIMIT || 50);
  await withDb(
    res,
    async (pool) => {
      const day = serverDay();
      const { rows } = await pool.query(
        `SELECT request_count FROM ai_usage_daily WHERE usage_date = $1 AND device_hash = $2`,
        [day, data.deviceHash]
      );
      const used = rows.length ? rows[0].request_count : 0;
      const allowed = used < limit;
      if (!allowed) {
        await pool.query(
          `INSERT INTO ai_usage_daily (usage_date, device_hash, app_version, denied_count)
           VALUES ($1,$2,$3,1)
           ON CONFLICT (usage_date, device_hash)
           DO UPDATE SET denied_count = ai_usage_daily.denied_count + 1`,
          [day, data.deviceHash, data.appVersion]
        );
      }
      res.json({
        ok: true,
        allowed,
        remaining: Math.max(0, limit - used),
        reason: allowed ? null : "daily_limit_reached",
      });
    },
    () => res.json({ ok: true, allowed: true, remaining: null, reason: "guard_unavailable" })
  );
});

// --- POST /v1/ai/usage-summary — device daily usage for Beta Diagnostics cost panel ---
router.post("/v1/ai/usage-summary", async (req, res) => {
  const data = parseBody(usageSchema, req, res);
  if (!data) return;
  await withDb(
    res,
    async (pool) => {
      const day = serverDay();
      const { rows } = await pool.query(
        `SELECT request_count, denied_count, first_request_at, last_request_at
         FROM ai_usage_daily WHERE usage_date = $1 AND device_hash = $2`,
        [day, data.deviceHash]
      );
      const row = rows[0] || {};
      const requests = row.request_count || 0;
      const denied = row.denied_count || 0;
      const inputTokensEst = requests * 1500;
      const outputTokensEst = requests * 900;
      const estimatedCostUsd = Number((requests * 0.004).toFixed(4));
      res.json({
        ok: true,
        usageDate: day,
        requestCount: requests,
        deniedCount: denied,
        inputTokensEst,
        outputTokensEst,
        estimatedCostUsd,
      });
    },
    () =>
      res.json({
        ok: true,
        usageDate: serverDay(),
        requestCount: 0,
        deniedCount: 0,
        inputTokensEst: 0,
        outputTokensEst: 0,
        estimatedCostUsd: 0,
        guardUnavailable: true,
      })
  );
});

// --- POST /v1/ai/record-usage (§11.3) — fail-soft: losing one metadata point must
// never fail the client's AI flow. ---
router.post("/v1/ai/record-usage", async (req, res) => {
  const data = parseBody(usageSchema, req, res);
  if (!data) return;
  await withDb(
    res,
    async (pool) => {
      await pool.query(
        `INSERT INTO ai_usage_daily (usage_date, device_hash, app_version, request_count, first_request_at, last_request_at)
         VALUES ($1,$2,$3,1,NOW(),NOW())
         ON CONFLICT (usage_date, device_hash)
         DO UPDATE SET request_count = ai_usage_daily.request_count + 1,
                       last_request_at = NOW(),
                       app_version = COALESCE(EXCLUDED.app_version, ai_usage_daily.app_version)`,
        [serverDay(), data.deviceHash, data.appVersion]
      );
      res.json({ ok: true });
    },
    () => res.json({ ok: true, recorded: false })
  );
});

// Body-parser errors on /v1 (bad JSON / oversized payload) → clean 4xx, no stacktrace.
router.use("/v1", (err, _req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "payload_too_large" });
  }
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }
  return next(err);
});

module.exports = router;
module.exports.templateSignalSchema = templateSignalSchema;

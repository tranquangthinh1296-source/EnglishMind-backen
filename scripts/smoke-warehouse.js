#!/usr/bin/env node
/**
 * B2 smoke — insert/select/delete one row per warehouse table.
 * Usage: DATABASE_URL=postgres://... node scripts/smoke-warehouse.js
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getPool, ensureWarehouseSchema } = require("../src/db");

async function smokeTable(label, run) {
  try {
    await run();
    console.log(`PASS: ${label}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${label} — ${err.message}`);
    return false;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("SKIP: DATABASE_URL not set (PENDING-QA)");
    process.exit(0);
  }

  const ok = await ensureWarehouseSchema();
  if (!ok) {
    console.error("FAIL: ensureWarehouseSchema");
    process.exit(1);
  }

  const pool = getPool();
  let passed = 0;
  let failed = 0;
  let templateId = null;

  const track = async (label, fn) => {
    if (await smokeTable(label, fn)) passed++;
    else failed++;
  };

  await track("user_learning_events", async () => {
    const ins = await pool.query(
      `INSERT INTO user_learning_events (user_key, feature, event_type)
       VALUES ('dev:smoke', 'translate', 'generated') RETURNING id`
    );
    const id = ins.rows[0].id;
    await pool.query("SELECT 1 FROM user_learning_events WHERE id = $1", [id]);
    await pool.query("DELETE FROM user_learning_events WHERE id = $1", [id]);
  });

  await track("ai_generation_records", async () => {
    const ins = await pool.query(
      `INSERT INTO ai_generation_records (feature, input_hash, privacy_level, schema_version)
       VALUES ('translate', 'smoke_hash', 'private', 1) RETURNING id`
    );
    const id = ins.rows[0].id;
    await pool.query("SELECT 1 FROM ai_generation_records WHERE id = $1", [id]);
    await pool.query("DELETE FROM ai_generation_records WHERE id = $1", [id]);
  });

  await track("shared_templates", async () => {
    const ins = await pool.query(
      `INSERT INTO shared_templates (intent, vi_template, en_template)
       VALUES ('unknown', 'Xin chào', 'Hello') RETURNING id`
    );
    templateId = ins.rows[0].id;
    await pool.query("SELECT 1 FROM shared_templates WHERE id = $1", [templateId]);
  });

  await track("template_quality_signals", async () => {
    if (!templateId) throw new Error("missing templateId from shared_templates smoke");
    const ins = await pool.query(
      `INSERT INTO template_quality_signals (template_id, event_type, weight)
       VALUES ($1, 'copy', 2) RETURNING id`,
      [templateId]
    );
    const id = ins.rows[0].id;
    await pool.query("SELECT 1 FROM template_quality_signals WHERE id = $1", [id]);
    await pool.query("DELETE FROM template_quality_signals WHERE id = $1", [id]);
  });

  if (templateId) {
    await pool.query("DELETE FROM shared_templates WHERE id = $1", [templateId]);
  }

  await track("privacy_redaction_log", async () => {
    const ins = await pool.query(
      `INSERT INTO privacy_redaction_log (input_hash, detected_sensitive_types, privacy_level, action)
       VALUES ('abc123', ARRAY['email']::TEXT[], 'blocked_sensitive', 'classified') RETURNING id`
    );
    const id = ins.rows[0].id;
    await pool.query("SELECT 1 FROM privacy_redaction_log WHERE id = $1", [id]);
    await pool.query("DELETE FROM privacy_redaction_log WHERE id = $1", [id]);
  });

  console.log(`\nWarehouse smoke: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

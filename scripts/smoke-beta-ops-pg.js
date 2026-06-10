#!/usr/bin/env node
/**
 * B1+B2 PostgreSQL smoke — schema + insert/select/delete.
 * Usage (Railway public URL from PC):
 *   set DATABASE_URL=postgresql://...@...railway.app:PORT/railway
 *   set PGSSL=require
 *   node scripts/smoke-beta-ops-pg.js
 *
 * Internal URL (postgres.railway.internal) only works INSIDE Railway network.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { getPool, ensureBetaOpsSchema, ensureWarehouseSchema, isDbConfigured } = require("../src/db");

async function run(label, fn) {
  try {
    await fn();
    console.log(`PASS: ${label}`);
    return true;
  } catch (err) {
    console.error(`FAIL: ${label} — ${err.code || ""} ${err.message}`);
    return false;
  }
}

async function main() {
  if (!isDbConfigured()) {
    console.log("SKIP: DATABASE_URL not set");
    process.exit(0);
  }

  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL.replace(/^postgres:/, "http:")).hostname;
    } catch {
      return "?";
    }
  })();

  if (host.includes("railway.internal")) {
    console.error(
      "FAIL: postgres.railway.internal chỉ chạy TRONG Railway.\n" +
        "  • Gắn DATABASE_URL vào service server trên Railway (Variables).\n" +
        "  • Test từ PC: Postgres → Connect → Public URL + PGSSL=require."
    );
    process.exit(1);
  }

  let ok = 0;
  let fail = 0;
  const track = async (label, fn) => (await run(label, fn) ? ok++ : fail++);

  await track("ensureBetaOpsSchema", async () => {
    if (!(await ensureBetaOpsSchema())) throw new Error("schema failed");
  });

  await track("ensureWarehouseSchema", async () => {
    if (!(await ensureWarehouseSchema())) throw new Error("warehouse schema failed");
  });

  const pool = getPool();
  let feedbackId;
  await track("beta_feedback insert", async () => {
    const { rows } = await pool.query(
      `INSERT INTO beta_feedback (category, message) VALUES ('bug', 'smoke-beta-ops-pg') RETURNING id`
    );
    feedbackId = rows[0].id;
  });

  await track("beta_feedback select", async () => {
    const { rows } = await pool.query(`SELECT id FROM beta_feedback WHERE id = $1`, [feedbackId]);
    if (!rows.length) throw new Error("not found");
  });

  await track("beta_feedback cleanup", async () => {
    await pool.query(`DELETE FROM beta_feedback WHERE id = $1`, [feedbackId]);
  });

  console.log(`\nBeta Ops PG smoke: ${ok} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

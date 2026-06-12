// PostgreSQL pool for Beta Ops / Knowledge Warehouse tables.
// Q1 decision: PG only for NEW tables (beta_feedback, beta_bug_report, ai_usage_daily,
// beta_event_log); quota/tier/tower stay on Firestore. Missing DATABASE_URL is a
// supported state: routes degrade gracefully instead of crashing the server.
const fs = require("fs");
const path = require("path");

let pool = null;
let schemaReady = false;
let warehouseReady = false;

function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!isDbConfigured()) return null;
  if (!pool) {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      // Railway public proxy requires TLS without CA verification; internal URL and
      // local Postgres do not speak TLS. Set PGSSL=require when using the proxy URL.
      ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : false,
    });
    pool.on("error", (err) => console.error("[pg] idle client error:", err.message));
  }
  return pool;
}

// Runs sql/001_beta_ops.sql (idempotent CREATE IF NOT EXISTS). Safe to call per-request.
async function ensureBetaOpsSchema() {
  if (schemaReady) return true;
  const p = getPool();
  if (!p) return false;
  const ddl = fs.readFileSync(path.join(__dirname, "..", "sql", "001_beta_ops.sql"), "utf8");
  await p.query(ddl);
  schemaReady = true;
  return true;
}

// Runs sql/002_warehouse.sql (§11.5-11.9). Idempotent; separate flag from beta_ops.
async function ensureWarehouseSchema() {
  if (warehouseReady) return true;
  const p = getPool();
  if (!p) return false;
  const ddl = fs.readFileSync(path.join(__dirname, "..", "sql", "002_warehouse.sql"), "utf8");
  await p.query(ddl);
  warehouseReady = true;
  return true;
}

module.exports = { isDbConfigured, getPool, ensureBetaOpsSchema, ensureWarehouseSchema };

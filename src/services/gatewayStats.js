// In-memory AI gateway health stats — tracks success/fail rates across the
// lifetime of the current process. Resets on redeploy (by design; no DB needed).
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const REGION = (process.env.RAILWAY_REGION || "sfo").trim();

const stats = {
  successCount: 0,
  failCount: 0,
  lastError: null, // { message, timestamp } | null
  model: MODEL,
  region: REGION,
};

/** Increment successCount after a successful AI call. */
function recordSuccess() {
  stats.successCount += 1;
}

/**
 * Increment failCount and store the last error details.
 * @param {string} errorMessage
 */
function recordFailure(errorMessage) {
  stats.failCount += 1;
  stats.lastError = {
    message: String(errorMessage || "unknown error"),
    timestamp: new Date().toISOString(),
  };
}

/** Return a snapshot of the current stats object. */
function getStats() {
  return { ...stats };
}

/**
 * Return the success rate as a percentage (0–100).
 * Returns 100 when no calls have been made yet.
 */
function getSuccessRate() {
  const total = stats.successCount + stats.failCount;
  if (total === 0) return 100;
  return Math.round((stats.successCount / total) * 100);
}

module.exports = { recordSuccess, recordFailure, getStats, getSuccessRate };

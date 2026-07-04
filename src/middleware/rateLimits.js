const rateLimit = require("express-rate-limit");

function positiveIntEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function createIpLimiter() {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: positiveIntEnv("RATE_IP_5M", 120),
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "rate_limited" },
  });
}

function createUidLimiter(envName, fallback) {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: positiveIntEnv(envName, fallback),
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.uid || "unknown",
    message: { success: false, error: "rate_limited" },
  });
}

function createAccountDeleteLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.uid || "unknown",
    message: { success: false, error: "rate_limited" },
  });
}

module.exports = {
  positiveIntEnv,
  createIpLimiter,
  createUidLimiter,
  createAccountDeleteLimiter,
};

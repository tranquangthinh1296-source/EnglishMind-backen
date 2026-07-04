const opsMetrics = require("../services/opsMetrics");

function mode() {
  const raw = String(process.env.APP_CHECK_MODE || "off").toLowerCase().trim();
  if (raw === "log" || raw === "enforce") return raw;
  return "off";
}

function appCheckMonitor(deps = {}) {
  return async function appCheckMiddleware(req, res, next) {
    const currentMode = mode();
    if (currentMode === "off") return next();

    const token = req.headers["x-firebase-appcheck"];
    try {
      const admin = deps.admin || require("../firebase").admin;
      if (!token || typeof token !== "string") throw new Error("missing_app_check");
      await admin.appCheck().verifyToken(token);
      return next();
    } catch (e) {
      opsMetrics.recordAppCheckFailure(currentMode).catch(() => {});
      console.warn(
        JSON.stringify({
          event: "app_check_failed",
          mode: currentMode,
          path: req.originalUrl || req.url,
          message: e.message,
        }),
      );
      if (currentMode === "enforce") {
        return res.status(401).json({
          success: false,
          error: "app_check_failed",
        });
      }
      return next();
    }
  };
}

module.exports = { appCheckMonitor, mode };

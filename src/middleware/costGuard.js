const costEstimator = require("../services/costEstimator");
const { notifyOpsAlert } = require("../services/alertWebhook");

const COST_CAP_MESSAGE = "Hệ thống AI tạm nghỉ do đạt giới hạn chi phí ngày. Vui lòng quay lại sau.";

async function costGuard(_req, res, next) {
  const cap = Number(process.env.COST_KILL_DAILY_USD);
  if (!Number.isFinite(cap) || cap <= 0) return next();

  const restored = await costEstimator.restoreDailyCostFromFirestore();
  if (!restored.ok) return next();

  if (!costEstimator.isCostCapReached()) return next();
  notifyOpsAlert("cost_cap", costEstimator.snapshot()).catch(() => {});
  return res.status(503).json({
    success: false,
    error: "cost_cap",
    errorCode: "cost_cap",
    errorMessage: COST_CAP_MESSAGE,
  });
}

module.exports = { COST_CAP_MESSAGE, costGuard };

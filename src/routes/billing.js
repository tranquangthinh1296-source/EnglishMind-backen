// PAYMENTS-SECURITY-1: server-side Play purchase verification → Firestore tier.
const express = require("express");
const { verifyAuth } = require("../middleware/verifyAuth");
const { processBillingVerify } = require("../billing/verifyService");

const router = express.Router();

router.post("/billing/verify", verifyAuth, async (req, res) => {
  const productId = String(req.body?.productId || "").trim();
  const purchaseToken = String(req.body?.purchaseToken || "").trim();

  if (!productId || !purchaseToken) {
    return res.status(400).json({
      success: false,
      error: "missing_fields",
      errorMessage: "Thiếu productId hoặc purchaseToken.",
    });
  }

  const outcome = await processBillingVerify({
    uid: req.uid,
    productId,
    purchaseToken,
  });
  return res.status(outcome.status).json(outcome.body);
});

module.exports = router;

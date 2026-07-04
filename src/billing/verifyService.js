const { mapProductId } = require("./productMap");
const { verifySubscriptionPurchase } = require("./playVerify");
const { writeVerifiedTier, writeFreeTier } = require("./tierStore");

async function processBillingVerify(
  { uid, productId, purchaseToken },
  deps = {},
) {
  const mapping = mapProductId(productId);
  if (!mapping) {
    return {
      status: 400,
      body: {
        success: false,
        error: "unknown_product",
        errorMessage: "Product ID không được hỗ trợ.",
      },
    };
  }

  const verifyFn = deps.verifySubscriptionPurchase || verifySubscriptionPurchase;
  const writeTier = deps.writeVerifiedTier || writeVerifiedTier;
  const clearTier = deps.writeFreeTier || writeFreeTier;

  let result;
  try {
    result = await verifyFn(productId, purchaseToken);
  } catch (e) {
    const code = e.message || "verify_failed";
    if (code === "play_billing_not_configured" || code === "play_creds_missing") {
      return {
        status: 503,
        body: {
          success: false,
          error: "billing_unavailable",
          errorMessage: "Xác minh thanh toán chưa được cấu hình trên server.",
        },
      };
    }
    console.error("[billing/verify] play verify failed:", code);
    return {
      status: 502,
      body: {
        success: false,
        error: "verify_failed",
        errorMessage: "Không xác minh được giao dịch với Google Play.",
      },
    };
  }

  if (!result.valid) {
    await clearTier(uid);
    return {
      status: 200,
      body: {
        success: true,
        verified: false,
        plan: "free",
        reason: result.reason || "invalid",
      },
    };
  }

  await writeTier(uid, {
    tier: mapping.tier,
    productId,
    expiryMs: result.expiryMs,
  });

  return {
    status: 200,
    body: {
      success: true,
      verified: true,
      plan: mapping.plan,
      tier: mapping.tier,
      productId,
      expiryMs: result.expiryMs ?? null,
    },
  };
}

module.exports = { processBillingVerify };

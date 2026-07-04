// Maps Play subscription product IDs → Firestore tier + server plan (PAYMENTS-SECURITY-1).
const PRODUCT_MAP = {
  englishmind_plus_monthly: { tier: "PLUS", plan: "plus" },
  englishmind_pro_ai_monthly: { tier: "PRO_AI", plan: "pro" },
};

function mapProductId(productId) {
  return PRODUCT_MAP[String(productId || "").trim()] || null;
}

function isKnownProduct(productId) {
  return Boolean(mapProductId(productId));
}

module.exports = { mapProductId, isKnownProduct, PRODUCT_MAP };

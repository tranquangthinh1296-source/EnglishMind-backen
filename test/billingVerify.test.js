const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const { mapProductId, isKnownProduct } = require("../src/billing/productMap");
const {
  parseMockToken,
  MOCK_VALID_PREFIX,
  MOCK_EXPIRED_TOKEN,
  verifySubscriptionPurchase,
  isMockMode,
  __resetForTest,
} = require("../src/billing/playVerify");
const { processBillingVerify } = require("../src/billing/verifyService");

describe("billingVerify (PAYMENTS-SECURITY-1)", () => {
  const env = { ...process.env };

  after(() => {
    process.env = env;
    __resetForTest();
  });

  it("maps known Play product IDs to tier/plan", () => {
    assert.deepEqual(mapProductId("englishmind_plus_monthly"), {
      tier: "PLUS",
      plan: "plus",
    });
    assert.deepEqual(mapProductId("englishmind_pro_ai_monthly"), {
      tier: "PRO_AI",
      plan: "pro",
    });
    assert.equal(mapProductId("forged_product"), null);
    assert.equal(isKnownProduct("englishmind_plus_monthly"), true);
    assert.equal(isKnownProduct("spoof"), false);
  });

  it("mock verifier rejects forged token", () => {
    const result = parseMockToken("totally-forged-token");
    assert.equal(result.valid, false);
    assert.equal(result.reason, "invalid_token");
  });

  it("mock verifier accepts valid-mock prefix and rejects expired", () => {
    const ok = parseMockToken(`${MOCK_VALID_PREFIX}abc`);
    assert.equal(ok.valid, true);
    assert.ok(ok.expiryMs > Date.now());

    const expired = parseMockToken(MOCK_EXPIRED_TOKEN);
    assert.equal(expired.valid, false);
    assert.equal(expired.reason, "expired");
  });

  it("mock mode is disabled in production even when BILLING_MOCK is true", async () => {
    process.env.NODE_ENV = "production";
    process.env.BILLING_MOCK = "true";
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    __resetForTest();

    assert.equal(isMockMode(), false);
    const result = await verifySubscriptionPurchase(
      "englishmind_pro_ai_monthly",
      `${MOCK_VALID_PREFIX}prod`,
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "play_billing_not_configured");
  });

  it("mock mode accepts valid tokens only outside production with BILLING_MOCK=true", async () => {
    process.env.NODE_ENV = "test";
    process.env.BILLING_MOCK = "true";
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;

    assert.equal(isMockMode(), true);
    const result = await verifySubscriptionPurchase(
      "englishmind_pro_ai_monthly",
      `${MOCK_VALID_PREFIX}dev`,
    );
    assert.equal(result.valid, true);
  });

  it("production without Play credentials returns invalid without throwing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BILLING_MOCK;
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    __resetForTest();

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (line) => warnings.push(line);
    try {
      const result = await verifySubscriptionPurchase(
        "englishmind_pro_ai_monthly",
        `${MOCK_VALID_PREFIX}missing-creds`,
      );
      assert.equal(result.valid, false);
      assert.equal(result.reason, "play_billing_not_configured");
    } finally {
      console.warn = origWarn;
    }
    assert.equal(warnings.filter((line) => String(line).includes("play_billing_credentials_missing")).length, 1);
  });

  it("processBillingVerify grants tier on valid mock token", async () => {
    let written = null;
    const outcome = await processBillingVerify(
      {
        uid: "user-1",
        productId: "englishmind_pro_ai_monthly",
        purchaseToken: `${MOCK_VALID_PREFIX}test`,
      },
      {
        verifySubscriptionPurchase: async () => ({
          valid: true,
          expiryMs: 1_900_000_000_000,
        }),
        writeVerifiedTier: async (_uid, payload) => {
          written = payload;
        },
        writeFreeTier: async () => {
          throw new Error("should not downgrade");
        },
      },
    );
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.verified, true);
    assert.equal(outcome.body.plan, "pro");
    assert.deepEqual(written, {
      tier: "PRO_AI",
      productId: "englishmind_pro_ai_monthly",
      expiryMs: 1_900_000_000_000,
    });
  });

  it("processBillingVerify downgrades on invalid token", async () => {
    let cleared = false;
    const outcome = await processBillingVerify(
      {
        uid: "user-2",
        productId: "englishmind_plus_monthly",
        purchaseToken: "forged",
      },
      {
        verifySubscriptionPurchase: async () => ({
          valid: false,
          reason: "invalid_token",
        }),
        writeVerifiedTier: async () => {
          throw new Error("should not grant");
        },
        writeFreeTier: async () => {
          cleared = true;
        },
      },
    );
    assert.equal(outcome.status, 200);
    assert.equal(outcome.body.verified, false);
    assert.equal(outcome.body.plan, "free");
    assert.equal(cleared, true);
  });

  it("processBillingVerify rejects unknown product", async () => {
    const outcome = await processBillingVerify({
      uid: "user-3",
      productId: "unknown_sku",
      purchaseToken: "any",
    });
    assert.equal(outcome.status, 400);
    assert.equal(outcome.body.error, "unknown_product");
  });
});

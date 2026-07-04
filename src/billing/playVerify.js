// Google Play subscription verification — mockable for tests (PAYMENTS-SECURITY-1).
const MOCK_VALID_PREFIX = "valid-mock-";
const MOCK_EXPIRED_TOKEN = "valid-mock-expired";
let warnedMissingProductionCreds = false;

function parseMockToken(purchaseToken) {
  const token = String(purchaseToken || "");
  if (token === MOCK_EXPIRED_TOKEN) {
    return { valid: false, reason: "expired", expiryMs: Date.now() - 60_000 };
  }
  if (token.startsWith(MOCK_VALID_PREFIX)) {
    return { valid: true, expiryMs: Date.now() + 30 * 24 * 60 * 60 * 1000 };
  }
  return { valid: false, reason: "invalid_token" };
}

function isMockMode() {
  return process.env.BILLING_MOCK === "true" && process.env.NODE_ENV !== "production";
}

function hasPlayCredentials() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  return Boolean(raw && raw.trim().startsWith("{"));
}

async function getPlayAccessToken() {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim().startsWith("{")) {
    throw new Error("play_creds_missing");
  }
  const credentials = JSON.parse(raw);
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) throw new Error("play_token_unavailable");
  return tokenResponse.token;
}

async function verifyWithPlayApi(productId, purchaseToken) {
  const packageName =
    process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.aistudio.englishmind.vxbqkt";
  const accessToken = await getPlayAccessToken();
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/` +
    `${encodeURIComponent(packageName)}/purchases/subscriptions/` +
    `${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404 || res.status === 400) {
    return { valid: false, reason: "invalid_token" };
  }
  if (!res.ok) {
    throw new Error(`play_api_${res.status}`);
  }
  const body = await res.json();
  const expiryMs = Number(body.expiryTimeMillis || 0);
  const paymentState = Number(body.paymentState ?? 1);
  const now = Date.now();
  if (expiryMs > 0 && expiryMs < now) {
    return { valid: false, reason: "expired", expiryMs };
  }
  if (paymentState === 0) {
    return { valid: false, reason: "pending" };
  }
  return { valid: true, expiryMs: expiryMs > 0 ? expiryMs : null };
}

async function verifySubscriptionPurchase(productId, purchaseToken, deps = {}) {
  const verifyImpl = deps.verifyImpl || defaultVerifyImpl;
  return verifyImpl(productId, purchaseToken);
}

async function defaultVerifyImpl(productId, purchaseToken) {
  if (isMockMode()) {
    return parseMockToken(purchaseToken);
  }
  if (!hasPlayCredentials()) {
    if (process.env.NODE_ENV === "production" && !warnedMissingProductionCreds) {
      warnedMissingProductionCreds = true;
      console.warn(
        JSON.stringify({
          event: "play_billing_credentials_missing",
          env: "production",
        }),
      );
    }
    return { valid: false, reason: "play_billing_not_configured" };
  }
  return verifyWithPlayApi(productId, purchaseToken);
}

function __resetForTest() {
  warnedMissingProductionCreds = false;
}

module.exports = {
  verifySubscriptionPurchase,
  parseMockToken,
  MOCK_VALID_PREFIX,
  MOCK_EXPIRED_TOKEN,
  isMockMode,
  hasPlayCredentials,
  __resetForTest,
};

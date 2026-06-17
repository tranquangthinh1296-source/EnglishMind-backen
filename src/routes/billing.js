// POST /api/billing/verify — server-side Play Store purchase verification (PAYMENTS-SECURITY-1).
// Verifies a purchaseToken against the Google Play Android Publisher API and
// writes the resolved tier to Firestore users/{uid}/tier/current.
//
// Required env vars:
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON  — full service-account JSON (Railway secret)
//   GOOGLE_PLAY_PACKAGE_NAME          — e.g. "com.englishmind.app"

const express = require("express");
const https = require("https");
const crypto = require("crypto");
const { verifyAuth } = require("../middleware/verifyAuth");
const { db } = require("../firebase");

const router = express.Router();

// ─── Product → tier mapping ───────────────────────────────────────────────────
const PRODUCT_TIER_MAP = {
  englishmind_plus_monthly: "plus",
  englishmind_pro_ai_monthly: "pro",
};

// ─── Minimal JWT / OAuth2 helpers (no extra deps) ────────────────────────────

/** Base64url-encode a Buffer or string. */
function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Build and sign a Google service-account JWT, then exchange it for an
 * access token via the OAuth2 token endpoint.
 * Scope: https://www.googleapis.com/auth/androidpublisher
 */
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  const signingInput = `${header}.${claim}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(signingInput);
  sign.end();
  const signature = b64url(sign.sign(serviceAccount.private_key));
  const jwt = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "oauth2.googleapis.com",
        path: "/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed.access_token) {
              resolve(parsed.access_token);
            } else {
              reject(new Error(`OAuth2 token error: ${raw}`));
            }
          } catch (e) {
            reject(new Error(`OAuth2 parse error: ${raw}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Call the Google Play Android Publisher API to verify a subscription purchase.
 * Returns the parsed API response body.
 * Throws with statusCode property on non-2xx responses.
 */
async function verifyPlayStorePurchase({ packageName, productId, purchaseToken, accessToken }) {
  const path =
    `/androidpublisher/v3/applications/${encodeURIComponent(packageName)}` +
    `/purchases/subscriptions/${encodeURIComponent(productId)}` +
    `/tokens/${encodeURIComponent(purchaseToken)}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "androidpublisher.googleapis.com",
        path,
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const err = new Error(
                `Play API ${res.statusCode}: ${parsed?.error?.message || raw}`,
              );
              err.statusCode = res.statusCode;
              reject(err);
            }
          } catch (e) {
            const err = new Error(`Play API parse error: ${raw}`);
            err.statusCode = res.statusCode;
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

router.post("/billing/verify", verifyAuth, async (req, res) => {
  const { productId, purchaseToken } = req.body || {};
  const uid = req.uid;

  // Validate request body.
  if (!productId || typeof productId !== "string" || !purchaseToken || typeof purchaseToken !== "string") {
    return res.status(400).json({
      success: false,
      error: "invalid_body",
      errorMessage: "Body must include non-empty 'productId' and 'purchaseToken' strings.",
    });
  }

  const tier = PRODUCT_TIER_MAP[productId];
  if (!tier) {
    return res.status(400).json({
      success: false,
      error: "unknown_product",
      errorMessage: `Unknown productId: ${productId}`,
    });
  }

  // Load service account from env.
  const saRaw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;

  if (!saRaw || !packageName) {
    console.error("[billing/verify] Missing GOOGLE_PLAY_SERVICE_ACCOUNT_JSON or GOOGLE_PLAY_PACKAGE_NAME env vars");
    return res.status(500).json({
      success: false,
      error: "server_misconfigured",
      errorMessage: "Billing verification is not configured on this server.",
    });
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(saRaw);
  } catch {
    console.error("[billing/verify] GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON");
    return res.status(500).json({
      success: false,
      error: "server_misconfigured",
      errorMessage: "Billing verification is misconfigured on this server.",
    });
  }

  // Obtain OAuth2 access token and call Play API.
  let accessToken;
  try {
    accessToken = await getAccessToken(serviceAccount);
  } catch (e) {
    console.error("[billing/verify] Failed to obtain access token:", e.message);
    return res.status(500).json({
      success: false,
      error: "auth_token_error",
      errorMessage: "Failed to authenticate with Google Play API.",
    });
  }

  let purchaseData;
  try {
    purchaseData = await verifyPlayStorePurchase({ packageName, productId, purchaseToken, accessToken });
  } catch (e) {
    // 404 or 410 from Play API means the token is invalid / already consumed.
    if (e.statusCode === 404 || e.statusCode === 410) {
      console.log(
        JSON.stringify({ event: "billing_verify", uid, productId, success: false, reason: "invalid_token" }),
      );
      return res.status(403).json({
        success: false,
        error: "purchase_not_found",
        errorMessage: "Purchase token could not be verified with Google Play.",
      });
    }
    // 401/403 from Play API — service account lacks permission or token is bad.
    if (e.statusCode === 401 || e.statusCode === 403) {
      console.log(
        JSON.stringify({ event: "billing_verify", uid, productId, success: false, reason: "play_auth_failed" }),
      );
      return res.status(403).json({
        success: false,
        error: "verification_failed",
        errorMessage: "Purchase verification failed.",
      });
    }
    console.error("[billing/verify] Play API error:", e.message);
    return res.status(500).json({
      success: false,
      error: "play_api_error",
      errorMessage: "An error occurred while verifying the purchase.",
    });
  }

  // purchaseData.paymentState: 0=pending, 1=received, 2=free trial, 3=deferred upgrade.
  // Only grant tier for confirmed payments (1) or free trials (2).
  const paymentState = purchaseData.paymentState;
  if (paymentState !== 1 && paymentState !== 2) {
    console.log(
      JSON.stringify({ event: "billing_verify", uid, productId, success: false, reason: "payment_pending", paymentState }),
    );
    return res.status(403).json({
      success: false,
      error: "payment_not_confirmed",
      errorMessage: "Purchase payment has not been confirmed yet.",
    });
  }

  // Write tier to Firestore.
  try {
    await db
      .collection("users")
      .doc(uid)
      .collection("tier")
      .doc("current")
      .set({
        tier,
        verifiedAt: new Date().toISOString(),
        purchaseToken,
      });
  } catch (e) {
    console.error("[billing/verify] Firestore write failed:", e.message);
    return res.status(500).json({
      success: false,
      error: "firestore_error",
      errorMessage: "Failed to save subscription tier.",
    });
  }

  console.log(JSON.stringify({ event: "billing_verify", uid, productId, tier, success: true }));

  return res.json({ success: true, tier });
});

module.exports = router;

#!/usr/bin/env node
/**
 * Enable Firebase Auth sign-in providers (Anonymous + Email/Password) via Identity Toolkit Admin API.
 * Uses FIREBASE_SERVICE_ACCOUNT from server/.env or repo root .env — never logs secrets.
 *
 * Usage: node server/scripts/enable-auth-providers.js
 */
const https = require("https");
const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
  require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
} catch {
  /* optional */
}

const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith("{")) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    console.error("Missing FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS.");
    process.exit(1);
  }
}

function patchConfig(projectId, accessToken, body, updateMask) {
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "identitytoolkit.googleapis.com",
        path: `/admin/v2/projects/${projectId}/config?updateMask=${encodeURIComponent(updateMask)}`,
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(out || "{}"));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${out}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  initAdmin();
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    "englishmind-45a88";
  const { access_token: token } = await admin.app().options.credential.getAccessToken();

  const body = {
    signIn: {
      anonymous: { enabled: true },
      email: { enabled: true, passwordRequired: true },
    },
  };
  const mask = "signIn.anonymous.enabled,signIn.email.enabled,signIn.email.passwordRequired";

  const result = await patchConfig(projectId, token, body, mask);
  const anon = result?.signIn?.anonymous?.enabled;
  const email = result?.signIn?.email?.enabled;
  console.log(
    JSON.stringify({
      ok: true,
      projectId,
      anonymous: anon,
      emailPassword: email,
    }),
  );
}

main().catch((e) => {
  console.error("enable-auth-providers failed:", e.message);
  process.exit(1);
});

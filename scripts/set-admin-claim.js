#!/usr/bin/env node
/**
 * One-time: grant Firebase custom claim { admin: true } for owner QA.
 * Does NOT store or use account password — only Admin SDK + service account.
 *
 * Usage (PowerShell, from repo root):
 *   $env:FIREBASE_SERVICE_ACCOUNT = '<paste full JSON one line OR path to file>'
 *   node server/scripts/set-admin-claim.js tranquangthinh1296@gmail.com
 *
 * Or with key file:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\serviceAccount.json"
 *   node server/scripts/set-admin-claim.js tranquangthinh1296@gmail.com
 */
try {
  require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
} catch {
  /* optional */
}

const admin = require("firebase-admin");

function initAdmin() {
  if (admin.apps.length) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith("{")) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  } else {
    console.error(
      "Missing FIREBASE_SERVICE_ACCOUNT (JSON) or GOOGLE_APPLICATION_CREDENTIALS.",
    );
    process.exit(1);
  }
  return admin;
}

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes("@")) {
    console.error("Usage: node server/scripts/set-admin-claim.js <owner-email>");
    process.exit(1);
  }

  initAdmin();
  const user = await admin.auth().getUserByEmail(email.trim());
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });

  const verified = await admin.auth().getUser(user.uid);
  console.log(JSON.stringify({
    ok: true,
    email: verified.email,
    uid: verified.uid,
    customClaims: verified.customClaims,
    nextStep: "Owner: logout + login lại trên app để token nhận claim admin.",
  }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});

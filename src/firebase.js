// Firebase Admin SDK bootstrap.
// Credentials resolve in this order:
//   1. FIREBASE_SERVICE_ACCOUNT (full JSON in one env var) — best for Railway.
//   2. GOOGLE_APPLICATION_CREDENTIALS (path to a key file) — best for local.
const admin = require("firebase-admin");

function init() {
  if (admin.apps.length) return admin;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw && raw.trim().startsWith("{")) {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } else {
    // Uses GOOGLE_APPLICATION_CREDENTIALS or workload identity.
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
  return admin;
}

const app = init();
const auth = app.auth();
const db = app.firestore();

module.exports = { admin: app, auth, db };

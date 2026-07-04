const express = require("express");
const { verifyAuth } = require("../middleware/verifyAuth");
const { createAccountDeleteLimiter } = require("../middleware/rateLimits");

function defaultDeps() {
  const { auth, db } = require("../firebase");
  return { auth, db };
}

function logAccountDeleteMeta({ uid, success, errorCode, latencyMs }) {
  console.log(
    JSON.stringify({
      event: "account_delete",
      uidHash: uid ? uid.slice(0, 8) : null,
      success,
      errorCode: errorCode || null,
      latencyMs,
    }),
  );
}

function createAccountRouter(deps = defaultDeps()) {
  const router = express.Router();
  const limiter = deps.limiter || createAccountDeleteLimiter();
  const authMiddleware = deps.verifyAuth || verifyAuth;
  const auth = deps.auth;
  const db = deps.db;

  router.post("/account/delete", authMiddleware, limiter, async (req, res) => {
    const started = Date.now();
    const uid = req.uid;
    const userRef = db.doc(`users/${uid}`);

    try {
      await db.recursiveDelete(userRef);
    } catch (e) {
      logAccountDeleteMeta({
        uid,
        success: false,
        errorCode: "firestore_delete_failed",
        latencyMs: Date.now() - started,
      });
      console.error(
        JSON.stringify({
          event: "account_delete_failed",
          phase: "firestore",
          uidHash: uid ? uid.slice(0, 8) : null,
          message: e.message,
        }),
      );
      return res.status(500).json({ ok: false, reason: "delete_failed" });
    }

    try {
      await auth.deleteUser(uid);
      logAccountDeleteMeta({
        uid,
        success: true,
        latencyMs: Date.now() - started,
      });
      return res.json({ ok: true });
    } catch (e) {
      logAccountDeleteMeta({
        uid,
        success: false,
        errorCode: "auth_delete_failed",
        latencyMs: Date.now() - started,
      });
      console.error(
        JSON.stringify({
          event: "account_delete_failed",
          phase: "auth",
          uidHash: uid ? uid.slice(0, 8) : null,
          message: e.message,
        }),
      );
      return res.status(500).json({ ok: false, reason: "delete_failed" });
    }
  });

  return router;
}

module.exports = { createAccountRouter, logAccountDeleteMeta };

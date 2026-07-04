// Server-authoritative tier writes (clients cannot write users/{uid}/tier/* per firestore.rules).
const { db } = require("../firebase");

async function writeVerifiedTier(uid, { tier, productId, expiryMs }) {
  await db.doc(`users/${uid}/tier/current`).set(
    {
      tier,
      productId,
      expiryMs: expiryMs ?? null,
      verifiedAt: Date.now(),
    },
    { merge: true },
  );
}

async function writeFreeTier(uid) {
  await db.doc(`users/${uid}/tier/current`).set(
    {
      tier: "FREE",
      productId: "",
      expiryMs: null,
      verifiedAt: Date.now(),
    },
    { merge: true },
  );
}

module.exports = { writeVerifiedTier, writeFreeTier };

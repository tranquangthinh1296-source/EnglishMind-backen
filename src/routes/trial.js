// GET api/trial-status/{installId}
// Tracks a per-install free-trial window in Firestore and returns a signed
// status. The signature lets the client detect tampering with the response.
const express = require("express");
const crypto = require("crypto");
const { db } = require("../firebase");

const router = express.Router();
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || "7", 10);
const SECRET = process.env.TRIAL_SIGNING_SECRET || "change-me";

function sign(installId, expiryDate, isActive) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${installId}|${expiryDate}|${isActive}`)
    .digest("hex");
}

router.get("/trial-status/:installId", async (req, res) => {
  const installId = req.params.installId;
  try {
    const ref = db.doc(`trials/${installId}`);
    const snap = await ref.get();

    let startedAt;
    if (snap.exists && snap.get("startedAt")) {
      startedAt = snap.get("startedAt");
    } else {
      startedAt = Date.now();
      await ref.set({ startedAt }, { merge: true });
    }

    const expiryDate = startedAt + TRIAL_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const isActive = now < expiryDate;
    const daysRemaining = Math.max(0, Math.ceil((expiryDate - now) / (24 * 60 * 60 * 1000)));

    return res.json({
      installId,
      isActive,
      daysRemaining,
      expiryDate,
      signature: sign(installId, expiryDate, isActive),
    });
  } catch (e) {
    console.error("[trial-status] failed:", e.message);
    return res.status(500).json({ success: false, error: "trial_error" });
  }
});

module.exports = router;

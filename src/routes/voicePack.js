// VOICE-PACK-1D — signed URL + manifest for OTA voice pack download.
const express = require("express");
const crypto = require("crypto");
const { verifyAuth } = require("../middleware/verifyAuth");
const { resolvePlan } = require("../middleware/planResolver");

const router = express.Router();

function buildManifest(version) {
  const packId = "englishmind_voice_pack_v1";
  const publicUrl = process.env.VOICE_PACK_PUBLIC_URL || "";
  const sha256 = process.env.VOICE_PACK_SHA256 || "";
  const sizeBytes = Number(process.env.VOICE_PACK_SIZE_BYTES || 0);
  const engine = process.env.VOICE_PACK_ENGINE || "mock";
  return {
    packId,
    version: version || process.env.VOICE_PACK_VERSION || "v1",
    downloadUrl: publicUrl,
    sha256,
    sizeBytes,
    engine,
    languageProfile: "vi-en-mixed",
    minAppVersion: process.env.VOICE_PACK_MIN_APP_VERSION || "1.1.0",
  };
}

router.get("/voice-pack/signed-url", verifyAuth, async (req, res) => {
  const enabled = process.env.VOICE_PACK_ENABLED === "true";
  if (!enabled) {
    return res.status(503).json({ success: false, error: "voice_pack_disabled" });
  }

  const proOnly = process.env.VOICE_PACK_PRO_ONLY !== "false";
  const plan = await resolvePlan(req.uid, req.claims || {});
  if (proOnly && !["pro", "coach_beta", "admin"].includes(plan)) {
    return res.status(403).json({ success: false, error: "pro_required" });
  }

  const version = String(req.query.version || "v1");
  const manifest = buildManifest(version);
  if (!manifest.downloadUrl || !manifest.sha256 || manifest.sizeBytes <= 0) {
    return res.status(503).json({ success: false, error: "voice_pack_not_configured" });
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const token = crypto
    .createHmac("sha256", process.env.VOICE_PACK_SIGNING_SECRET || "dev-voice-pack-secret")
    .update(`${req.uid}:${manifest.version}:${expiresAt}`)
    .digest("hex")
    .slice(0, 16);

  console.log(
    JSON.stringify({
      event: "voice_pack_signed_url",
      uidHash: req.uid ? req.uid.slice(0, 8) : null,
      plan,
      version: manifest.version,
      sizeBytes: manifest.sizeBytes,
    }),
  );

  return res.json({
    success: true,
    downloadUrl: manifest.downloadUrl,
    expiresAt,
    token,
    manifest,
  });
});

module.exports = router;

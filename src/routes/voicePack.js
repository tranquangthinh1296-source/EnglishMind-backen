// VOICE-PACK-1D — signed URL + manifest for OTA voice pack download (Whisper required, Vosk optional).
const express = require("express");
const crypto = require("crypto");
const { verifyAuth } = require("../middleware/verifyAuth");
const { resolvePlan } = require("../middleware/planResolver");

const router = express.Router();

function packConfig(kind) {
  const isVosk = kind === "vosk";
  const prefix = isVosk ? "VOICE_PACK_VOSK" : "VOICE_PACK_WHISPER";
  const fallbackPrefix = isVosk ? null : "VOICE_PACK";
  const read = (key, fallback = "") =>
    process.env[`${prefix}_${key}`] ||
    (fallbackPrefix ? process.env[`${fallbackPrefix}_${key}`] : null) ||
    fallback;

  const packId = isVosk ? "englishmind_vosk_pack_v1" : "englishmind_whisper_pack_v1";
  const engine = isVosk ? "vosk" : "whisper";
  const publicUrl = read("PUBLIC_URL");
  const sha256 = read("SHA256");
  const sizeBytes = Number(read("SIZE_BYTES", "0"));
  const version = read("VERSION", "v1");

  return {
    packId,
    version,
    downloadUrl: publicUrl,
    sha256,
    sizeBytes,
    engine,
    executionMode: isVosk ? "on_device" : "server",
    languageProfile: "vi-en-mixed",
    minAppVersion: process.env.VOICE_PACK_MIN_APP_VERSION || "1.0.2-beta",
  };
}

router.get("/voice-pack/signed-url", verifyAuth, async (req, res) => {
  const enabled = process.env.VOICE_PACK_ENABLED === "true";
  if (!enabled) {
    return res.status(503).json({ success: false, error: "voice_pack_disabled" });
  }

  const kind = String(req.query.kind || "whisper").toLowerCase();
  if (kind === "vosk" && process.env.VOICE_PACK_VOSK_ENABLED === "false") {
    return res.status(503).json({ success: false, error: "vosk_pack_disabled" });
  }

  const proOnly = process.env.VOICE_PACK_PRO_ONLY !== "false";
  const plan = await resolvePlan(req.uid, req.claims || {});
  if (proOnly && !["pro", "coach_beta", "admin"].includes(plan)) {
    return res.status(403).json({ success: false, error: "pro_required" });
  }

  const version = String(req.query.version || "v1");
  const manifest = { ...packConfig(kind === "vosk" ? "vosk" : "whisper"), version };
  if (!manifest.downloadUrl || !manifest.sha256 || manifest.sizeBytes <= 0) {
    return res.status(503).json({ success: false, error: "voice_pack_not_configured", kind });
  }

  const expiresAt = Date.now() + 15 * 60 * 1000;
  const token = crypto
    .createHmac("sha256", process.env.VOICE_PACK_SIGNING_SECRET || "dev-voice-pack-secret")
    .update(`${req.uid}:${kind}:${manifest.version}:${expiresAt}`)
    .digest("hex")
    .slice(0, 16);

  console.log(
    JSON.stringify({
      event: "voice_pack_signed_url",
      uidHash: req.uid ? req.uid.slice(0, 8) : null,
      plan,
      kind,
      version: manifest.version,
      engine: manifest.engine,
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

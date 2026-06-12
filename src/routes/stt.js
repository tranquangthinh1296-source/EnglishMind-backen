// VOICE-STT-SERVER-1 — POST /api/stt/transcribe (Q6 owner 2026-06-12).
// Whisper.cpp chạy server-side; kết quả cache theo user (uid + audio hash) trong
// Firestore `sttCache` — replay không tốn compute. Audio xóa ngay sau xử lý,
// log metadata-only (KHÔNG log transcript/audio).
const express = require("express");
const { verifyAuth } = require("../middleware/verifyAuth");
const { db } = require("../firebase");
const {
  isSttEnabled,
  isEngineConfigured,
  cacheKey,
  validateSttRequest,
  transcribeWithWhisper,
} = require("../services/sttEngine");

const router = express.Router();

const CACHE_COLLECTION = "sttCache";
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 ngày

function logSttMeta({ uid, plan, bytes, language, cacheHit, success, errorCode, latencyMs }) {
  console.log(
    JSON.stringify({
      event: "stt_call",
      uidHash: uid ? uid.slice(0, 8) : null,
      plan: plan || null,
      audioBytes: bytes || 0,
      language: language || "auto",
      engine: "whisper.cpp",
      cacheHit,
      success,
      errorCode: errorCode || null,
      latencyMs,
    }),
  );
}

router.post("/stt/transcribe", verifyAuth, async (req, res) => {
  const started = Date.now();
  const { audioBase64, language = "auto", audioConsent = false } = req.body || {};

  if (!isSttEnabled()) {
    return res.status(503).json({ success: false, error: "stt_disabled" });
  }

  let audioBuffer = null;
  try {
    if (typeof audioBase64 === "string" && audioBase64.length > 0) {
      audioBuffer = Buffer.from(audioBase64, "base64");
    }
  } catch {
    audioBuffer = null;
  }

  const check = validateSttRequest({ audioBuffer, language, audioConsent });
  if (!check.ok) {
    logSttMeta({
      uid: req.uid, plan: req.plan, bytes: audioBuffer ? audioBuffer.length : 0,
      language, cacheHit: false, success: false, errorCode: check.error,
      latencyMs: Date.now() - started,
    });
    return res.status(check.status).json({ success: false, error: check.error });
  }

  const key = cacheKey(req.uid, audioBuffer);
  const docRef = db.collection(CACHE_COLLECTION).doc(key);

  try {
    const cached = await docRef.get();
    if (cached.exists) {
      const data = cached.data();
      const fresh = Date.now() - (data.createdAt || 0) < CACHE_TTL_MS;
      if (fresh && typeof data.transcript === "string") {
        logSttMeta({
          uid: req.uid, plan: req.plan, bytes: audioBuffer.length, language,
          cacheHit: true, success: true, latencyMs: Date.now() - started,
        });
        return res.json({ success: true, transcript: data.transcript, cached: true, engine: data.engine || "whisper.cpp" });
      }
    }
  } catch (e) {
    // Cache đọc lỗi → coi như miss, không chặn flow.
  }

  if (!isEngineConfigured()) {
    logSttMeta({
      uid: req.uid, plan: req.plan, bytes: audioBuffer.length, language,
      cacheHit: false, success: false, errorCode: "engine_unavailable",
      latencyMs: Date.now() - started,
    });
    return res.status(503).json({ success: false, error: "engine_unavailable" });
  }

  try {
    const { transcript, engine } = await transcribeWithWhisper(audioBuffer, language);
    await docRef.set({
      transcript,
      engine,
      language,
      audioBytes: audioBuffer.length,
      createdAt: Date.now(),
    }).catch(() => {});
    logSttMeta({
      uid: req.uid, plan: req.plan, bytes: audioBuffer.length, language,
      cacheHit: false, success: true, latencyMs: Date.now() - started,
    });
    return res.json({ success: true, transcript, cached: false, engine });
  } catch (e) {
    const errorCode = e && e.message === "stt_timeout" ? "stt_timeout" : "stt_engine_error";
    logSttMeta({
      uid: req.uid, plan: req.plan, bytes: audioBuffer.length, language,
      cacheHit: false, success: false, errorCode,
      latencyMs: Date.now() - started,
    });
    return res.status(502).json({ success: false, error: errorCode });
  }
});

module.exports = router;

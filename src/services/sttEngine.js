// VOICE-STT-SERVER-1 — server-side STT engine adapter (Q6 owner 2026-06-12).
// Engine chạy TRÊN SERVER (whisper.cpp binary), model KHÔNG nằm trong APK.
// Env:
//   SERVER_STT_ENABLED  "true" để mở endpoint (default OFF — fail-closed).
//   STT_ENGINE          "whisper" (default) — chạy binary whisper.cpp qua child_process.
//   WHISPER_BIN         đường dẫn binary whisper.cpp (vd /app/bin/whisper-cli).
//   WHISPER_MODEL       đường dẫn model gguf (vd /app/models/ggml-base-q5_1.bin).
//   STT_TIMEOUT_MS      timeout 1 lần transcribe (default 20000).
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const MAX_AUDIO_BYTES = 1.5 * 1024 * 1024; // ~15s wav 16k mono — chặn upload dài
const ALLOWED_LANGUAGES = new Set(["vi", "en", "auto"]);

function isSttEnabled() {
  return process.env.SERVER_STT_ENABLED === "true";
}

function isEngineConfigured() {
  return Boolean(process.env.WHISPER_BIN && process.env.WHISPER_MODEL);
}

/** Cache key theo user: uid + sha256(audio) — replay không tốn compute. */
function cacheKey(uid, audioBuffer) {
  const hash = crypto.createHash("sha256").update(audioBuffer).digest("hex");
  return `${uid}_${hash}`;
}

/**
 * Validate request body (đã decode). Trả {ok} hoặc {ok:false, error, status}.
 * Consent upload audio là consent RIÊNG (không dùng chung learning-profile consent).
 */
function validateSttRequest({ audioBuffer, language, audioConsent }) {
  if (audioConsent !== true) {
    return { ok: false, status: 403, error: "consent_required" };
  }
  if (!audioBuffer || audioBuffer.length === 0) {
    return { ok: false, status: 400, error: "invalid_request" };
  }
  if (audioBuffer.length > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, error: "audio_too_large" };
  }
  if (language && !ALLOWED_LANGUAGES.has(language)) {
    return { ok: false, status: 400, error: "unsupported_language" };
  }
  return { ok: true };
}

/**
 * Chạy whisper.cpp trên file wav tạm; xóa file ngay sau khi xong (privacy —
 * audio không bao giờ ghi bền trên server, chỉ transcript vào cache).
 */
async function transcribeWithWhisper(audioBuffer, language = "auto") {
  const bin = process.env.WHISPER_BIN;
  const model = process.env.WHISPER_MODEL;
  const timeoutMs = Number(process.env.STT_TIMEOUT_MS || 20000);
  const tmpFile = path.join(os.tmpdir(), `stt_${crypto.randomUUID()}.wav`);
  await fs.writeFile(tmpFile, audioBuffer);
  try {
    const args = ["-m", model, "-f", tmpFile, "--no-timestamps", "--output-json", "false"];
    if (language && language !== "auto") args.push("-l", language);
    const transcript = await new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("stt_timeout"));
      }, timeoutMs);
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d.toString().slice(0, 200); });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`stt_engine_exit_${code}`));
      });
    });
    return { transcript, engine: "whisper.cpp" };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

module.exports = {
  MAX_AUDIO_BYTES,
  isSttEnabled,
  isEngineConfigured,
  cacheKey,
  validateSttRequest,
  transcribeWithWhisper,
};

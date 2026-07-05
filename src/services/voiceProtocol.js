const CLIENT_EVENT_TYPES = new Set([
  "session.start",
  "audio.input",
  "text.input",
  "barge_in",
  "session.end",
]);

const SERVER_EVENT_TYPES = new Set([
  "session.ready",
  "transcript.partial",
  "transcript.final",
  "audio.output",
  "learning.marker",
  "error",
  "session.closed",
]);

const VOICE_MODES = new Set(["live_tutor", "live_translate"]);
const AUDIO_INPUT_MIME_TYPE = "audio/pcm;rate=16000";
const TEXT_INPUT_MAX_CHARS = 500;

function expiresAtMs(meta) {
  if (!meta || meta.expiresAt === undefined || meta.expiresAt === null) return null;
  if (typeof meta.expiresAt === "number") return meta.expiresAt;
  const parsed = Date.parse(meta.expiresAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function validateClientEvent(obj, sessionMeta = null) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "invalid_event" };
  }
  if (!CLIENT_EVENT_TYPES.has(obj.type)) {
    return { ok: false, error: "unsupported_event_type" };
  }

  const expiry = expiresAtMs(sessionMeta);
  if (expiry !== null && expiry <= Date.now()) {
    return { ok: false, error: "session_expired" };
  }

  if (obj.type === "session.start") {
    if (!VOICE_MODES.has(obj.mode)) return { ok: false, error: "unsupported_voice_mode" };
    if (sessionMeta && obj.sessionId && obj.sessionId !== sessionMeta.sessionId) {
      return { ok: false, error: "invalid_session" };
    }
  }

  if (obj.type === "audio.input" && obj.mimeType !== AUDIO_INPUT_MIME_TYPE) {
    return { ok: false, error: "unsupported_audio_format" };
  }

  if (obj.type === "text.input") {
    if (typeof obj.text !== "string") return { ok: false, error: "invalid_text" };
    if (obj.text.length > TEXT_INPUT_MAX_CHARS) return { ok: false, error: "text_too_long" };
  }

  return { ok: true };
}

function makeServerEvent(type, payload = {}) {
  if (!SERVER_EVENT_TYPES.has(type)) {
    throw new Error(`unsupported_server_event:${type}`);
  }
  return { type, ...payload };
}

module.exports = {
  AUDIO_INPUT_MIME_TYPE,
  TEXT_INPUT_MAX_CHARS,
  VOICE_MODES,
  validateClientEvent,
  makeServerEvent,
};

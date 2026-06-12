const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_AUDIO_BYTES,
  isSttEnabled,
  isEngineConfigured,
  cacheKey,
  validateSttRequest,
} = require("../src/services/sttEngine");

describe("stt engine gates (VOICE-STT-SERVER-1)", () => {
  const env = { ...process.env };
  after(() => { process.env = env; });

  it("fail-closed: disabled by default", () => {
    delete process.env.SERVER_STT_ENABLED;
    assert.equal(isSttEnabled(), false);
    process.env.SERVER_STT_ENABLED = "false";
    assert.equal(isSttEnabled(), false);
    process.env.SERVER_STT_ENABLED = "true";
    assert.equal(isSttEnabled(), true);
  });

  it("engine unavailable without WHISPER_BIN/MODEL", () => {
    delete process.env.WHISPER_BIN;
    delete process.env.WHISPER_MODEL;
    assert.equal(isEngineConfigured(), false);
    process.env.WHISPER_BIN = "/app/bin/whisper-cli";
    assert.equal(isEngineConfigured(), false);
    process.env.WHISPER_MODEL = "/app/models/ggml-base-q5_1.bin";
    assert.equal(isEngineConfigured(), true);
  });

  it("consent is required before any processing", () => {
    const buf = Buffer.from("audio");
    const r = validateSttRequest({ audioBuffer: buf, language: "vi", audioConsent: false });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.error, "consent_required");
  });

  it("rejects oversized and empty audio", () => {
    const big = Buffer.alloc(MAX_AUDIO_BYTES + 1);
    assert.equal(validateSttRequest({ audioBuffer: big, language: "vi", audioConsent: true }).error, "audio_too_large");
    assert.equal(validateSttRequest({ audioBuffer: Buffer.alloc(0), language: "vi", audioConsent: true }).error, "invalid_request");
    assert.equal(validateSttRequest({ audioBuffer: null, language: "vi", audioConsent: true }).error, "invalid_request");
  });

  it("rejects unsupported language, accepts vi/en/auto", () => {
    const buf = Buffer.from("audio");
    assert.equal(validateSttRequest({ audioBuffer: buf, language: "fr", audioConsent: true }).error, "unsupported_language");
    for (const lang of ["vi", "en", "auto", undefined]) {
      assert.equal(validateSttRequest({ audioBuffer: buf, language: lang, audioConsent: true }).ok, true);
    }
  });

  it("cache key is per user + audio hash (deterministic)", () => {
    const a = Buffer.from("same audio");
    assert.equal(cacheKey("user1", a), cacheKey("user1", Buffer.from("same audio")));
    assert.notEqual(cacheKey("user1", a), cacheKey("user2", a));
    assert.notEqual(cacheKey("user1", a), cacheKey("user1", Buffer.from("other audio")));
    assert.match(cacheKey("user1", a), /^user1_[0-9a-f]{64}$/);
  });
});

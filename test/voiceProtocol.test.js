const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validateClientEvent, makeServerEvent } = require("../src/services/voiceProtocol");

describe("voice live protocol", () => {
  it("rejects unknown client event types", () => {
    const result = validateClientEvent({ type: "banana" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unsupported_event_type");
  });

  it("rejects text input over 500 characters", () => {
    const result = validateClientEvent({ type: "text.input", text: "x".repeat(501) });
    assert.equal(result.ok, false);
    assert.equal(result.error, "text_too_long");
  });

  it("rejects unsupported audio mime types", () => {
    const result = validateClientEvent({
      type: "audio.input",
      mimeType: "audio/webm",
      data: "abc",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unsupported_audio_format");
  });

  it("rejects unsupported live modes", () => {
    const result = validateClientEvent({
      type: "session.start",
      sessionId: "vl_20260705_test",
      mode: "banana",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "unsupported_voice_mode");
  });

  it("builds allowlisted server event envelopes", () => {
    const event = makeServerEvent("error", {
      code: "live_upstream_error",
      fallback: "classic",
    });
    assert.deepEqual(event, {
      type: "error",
      code: "live_upstream_error",
      fallback: "classic",
    });
  });
});

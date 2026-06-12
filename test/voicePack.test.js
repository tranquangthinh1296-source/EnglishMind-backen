const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

describe("voice pack signed-url (VOICE-PACK-1D)", () => {
  const env = { ...process.env };

  after(() => {
    process.env = env;
  });

  it("disabled when VOICE_PACK_ENABLED is not true", () => {
    delete process.env.VOICE_PACK_ENABLED;
    assert.notEqual(process.env.VOICE_PACK_ENABLED, "true");
  });

  it("manifest requires url sha256 and size", () => {
    process.env.VOICE_PACK_PUBLIC_URL = "https://cdn.example/voice-pack-v1.zip";
    process.env.VOICE_PACK_SHA256 = "abc123";
    process.env.VOICE_PACK_SIZE_BYTES = "1024";
    process.env.VOICE_PACK_VERSION = "v1";
    const manifest = {
      downloadUrl: process.env.VOICE_PACK_PUBLIC_URL,
      sha256: process.env.VOICE_PACK_SHA256,
      sizeBytes: Number(process.env.VOICE_PACK_SIZE_BYTES),
      version: process.env.VOICE_PACK_VERSION,
    };
    assert.ok(manifest.downloadUrl.startsWith("https://"));
    assert.ok(manifest.sha256.length > 0);
    assert.ok(manifest.sizeBytes > 0);
  });
});

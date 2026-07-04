const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  sanitizeKey,
  normalizePlatform,
  ALLOWED_WEB_EVENTS,
  ALLOWED_META_KEYS,
} = require("../src/services/opsMetrics");

describe("opsMetrics", () => {
  it("sanitizes firestore field keys", () => {
    assert.equal(sanitizeKey("translate_core"), "translate_core");
    assert.equal(sanitizeKey("Foo Bar!"), "foo_bar_");
  });

  it("normalizes platform header values", () => {
    assert.equal(normalizePlatform("web"), "web");
    assert.equal(normalizePlatform("Android"), "android");
    assert.equal(normalizePlatform(""), "unknown");
  });

  it("allowlists web event types and meta keys", () => {
    assert.ok(ALLOWED_WEB_EVENTS.has("web_page_view"));
    assert.ok(ALLOWED_WEB_EVENTS.has("web_tool_open"));
    assert.ok(!ALLOWED_WEB_EVENTS.has("prompt_leak"));
    assert.ok(ALLOWED_META_KEYS.has("tool"));
    assert.ok(!ALLOWED_META_KEYS.has("email_body"));
  });
});

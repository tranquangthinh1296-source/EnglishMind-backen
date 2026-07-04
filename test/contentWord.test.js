const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { normalizeWordParam } = require("../src/routes/content");

describe("content word lookup helpers", () => {
  it("normalizes one English lookup word", () => {
    assert.equal(normalizeWordParam(" Apple! "), "apple");
    assert.equal(normalizeWordParam("can't"), "can't");
    assert.equal(normalizeWordParam("co-operate"), "co-operate");
  });

  it("rejects blank, sentence, and non-English lookup values", () => {
    assert.equal(normalizeWordParam(""), null);
    assert.equal(normalizeWordParam("hello world"), null);
    assert.equal(normalizeWordParam("xin chao"), null);
    assert.equal(normalizeWordParam("123"), null);
  });
});

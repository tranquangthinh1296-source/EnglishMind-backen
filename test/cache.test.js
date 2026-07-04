const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

describe("optional redis cache", () => {
  const env = { ...process.env };
  after(() => { process.env = env; });

  it("degrades to null/no-op when REDIS_URL is missing", async () => {
    delete process.env.REDIS_URL;
    const { isRedisConfigured, getCached, setCached } = require("../src/cache");
    assert.equal(isRedisConfigured(), false);
    assert.equal(await getCached("missing"), null);
    assert.equal(await setCached("missing", { ok: true }, 60), false);
  });
});

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const firebasePath = require.resolve("../src/firebase");
const geminiPath = require.resolve("../src/gemini");
const contentPath = require.resolve("../src/routes/content");

async function withContentServer({ floorExists = true } = {}, fn) {
  let generateCalls = 0;
  delete process.env.COST_KILL_DAILY_USD;
  delete require.cache[firebasePath];
  delete require.cache[geminiPath];
  delete require.cache[contentPath];
  require.cache[firebasePath] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: {
      auth: {
        async verifyIdToken(token) {
          if (token !== "good-token") throw new Error("bad token");
          return { uid: "tower-user", betaTester: true };
        },
      },
      db: {
        doc(path) {
          assert.equal(path, "users/tower-user/tier/current");
          return {
            async get() {
              return { exists: false, get: () => null };
            },
          };
        },
        collection(name) {
          assert.equal(name, "tower_floors");
          return {
            doc(id) {
              assert.equal(id, "GENERAL_1");
              return {
                async get() {
                  return {
                    exists: floorExists,
                    data: () => ({
                      floorNumber: 1,
                      towerMode: "GENERAL",
                      theme: "Cached",
                      units: [],
                    }),
                  };
                },
                async set() {},
              };
            },
          };
        },
      },
    },
  };
  require.cache[geminiPath] = {
    id: geminiPath,
    filename: geminiPath,
    loaded: true,
    exports: {
      async generate() {
        generateCalls += 1;
        throw new Error("gemini_should_not_be_called");
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/", require("../src/routes/content"));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`, () => generateCalls);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("tower auth", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
    delete require.cache[firebasePath];
    delete require.cache[geminiPath];
    delete require.cache[contentPath];
  });

  it("returns 401 without an auth token", async () => {
    await withContentServer({}, async (base) => {
      const res = await fetch(`${base}/v1/tower/GENERAL/1`);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error, "missing_token");
    });
  });

  it("serves cached tower floors without calling Gemini", async () => {
    await withContentServer({}, async (base, generateCalls) => {
      const res = await fetch(`${base}/v1/tower/GENERAL/1`, {
        headers: { authorization: "Bearer good-token" },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, "success");
      assert.equal(body.data.theme, "Cached");
      assert.equal(generateCalls(), 0);
    });
  });
});

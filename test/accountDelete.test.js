const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAccountRouter } = require("../src/routes/account");

function noLimit(_req, _res, next) {
  next();
}

function fakeVerifyAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "missing_token" });
  }
  req.uid = "user-1";
  req.plan = "free";
  return next();
}

async function withServer(router, fn) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("account delete route", () => {
  it("returns 401 without token", async () => {
    const router = createAccountRouter({
      verifyAuth: fakeVerifyAuth,
      limiter: noLimit,
      db: { doc: () => ({}), recursiveDelete: async () => {} },
      auth: { deleteUser: async () => {} },
    });

    await withServer(router, async (base) => {
      const res = await fetch(`${base}/api/account/delete`, { method: "POST" });
      assert.equal(res.status, 401);
    });
  });

  it("does not delete auth user when Firestore recursive delete fails", async () => {
    let authDeleted = false;
    const router = createAccountRouter({
      verifyAuth: fakeVerifyAuth,
      limiter: noLimit,
      db: {
        doc: (path) => ({ path }),
        recursiveDelete: async () => {
          throw new Error("firestore_down");
        },
      },
      auth: {
        deleteUser: async () => {
          authDeleted = true;
        },
      },
    });

    await withServer(router, async (base) => {
      const res = await fetch(`${base}/api/account/delete`, {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      });
      assert.equal(res.status, 500);
      assert.deepEqual(await res.json(), { ok: false, reason: "delete_failed" });
      assert.equal(authDeleted, false);
    });
  });

  it("deletes Firestore data before deleting auth user", async () => {
    const order = [];
    const router = createAccountRouter({
      verifyAuth: fakeVerifyAuth,
      limiter: noLimit,
      db: {
        doc: (path) => ({ path }),
        recursiveDelete: async (ref) => {
          order.push(`firestore:${ref.path}`);
        },
      },
      auth: {
        deleteUser: async (uid) => {
          order.push(`auth:${uid}`);
        },
      },
    });

    await withServer(router, async (base) => {
      const res = await fetch(`${base}/api/account/delete`, {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      });
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      assert.deepEqual(order, ["firestore:users/user-1", "auth:user-1"]);
    });
  });
});

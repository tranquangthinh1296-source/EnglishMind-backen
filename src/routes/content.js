// Content endpoints the app calls (curricula, lessons, vocabulary, word, tower).
// This new server doesn't host the original content DB, so by default it
// transparently proxies these GET requests to CONTENT_UPSTREAM_URL (the old
// Railway server). If that env is unset, the endpoints return 501 so failures
// are obvious instead of silently breaking the app.
//
// POST api/progress and api/lesson are also forwarded so existing write paths
// keep working.
const express = require("express");

const router = express.Router();
const UPSTREAM = (process.env.CONTENT_UPSTREAM_URL || "").replace(/\/$/, "");

// Forward the current request to the upstream content server.
async function proxy(req, res) {
  if (!UPSTREAM) {
    return res.status(501).json({
      success: false,
      error: "content_not_configured",
      errorMessage:
        "CONTENT_UPSTREAM_URL chưa cấu hình. Set env này tới server content cũ, hoặc tự host dữ liệu.",
    });
  }
  const target = `${UPSTREAM}${req.originalUrl}`;
  try {
    const init = { method: req.method, headers: { "Content-Type": "application/json" } };
    if (req.method !== "GET" && req.method !== "HEAD") {
      init.body = JSON.stringify(req.body || {});
    }
    const upstreamResp = await fetch(target, init);
    const text = await upstreamResp.text();
    res.status(upstreamResp.status);
    const ct = upstreamResp.headers.get("content-type");
    if (ct) res.set("content-type", ct);
    return res.send(text);
  } catch (e) {
    console.error("[content proxy] failed:", target, e.message);
    return res
      .status(502)
      .json({ success: false, error: "content_upstream_error", errorMessage: "Không lấy được nội dung." });
  }
}

router.get("/curricula", proxy);
router.get("/curriculum/:id", proxy);
router.get("/lesson/:id", proxy);
router.get("/vocabulary", proxy);
router.get("/word/:word", proxy);
router.get("/v1/tower/:towerMode/:floorNumber", proxy);
router.post("/progress", proxy);
router.post("/lesson", proxy);

module.exports = router;

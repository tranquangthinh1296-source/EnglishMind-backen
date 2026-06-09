// T38-BE — Server-side daily AI quota keyed by UID + SERVER day.
//
// Why server-side: the client counts quota with the device clock
// (EnglishMindRepository.todayString / DataStoreManager), which a user can
// bypass by changing the system time or using multiple devices. The server
// is the source of truth; the client number is display-only.
//
// Storage: Firestore doc aiQuota/{uid} = { date: "YYYY-MM-DD", count: number }.
// The transaction resets count when the stored date != today's server day.
const { db } = require("../firebase");

const LIMIT = parseInt(process.env.PRO_PROXY_DAILY_LIMIT || "1000", 10);
const TZ = process.env.QUOTA_TIMEZONE || "Asia/Ho_Chi_Minh";

// Today's date string in the configured timezone, e.g. "2026-06-09".
function serverDay() {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Reserve one unit atomically. Returns { ok, count, limit }.
async function reserve(uid) {
  const ref = db.doc(`aiQuota/${uid}`);
  const today = serverDay();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const current = data && data.date === today ? data.count || 0 : 0;
    if (current >= LIMIT) {
      return { ok: false, count: current, limit: LIMIT };
    }
    const next = current + 1;
    tx.set(ref, { date: today, count: next }, { merge: true });
    return { ok: true, count: next, limit: LIMIT };
  });
}

// Refund one unit (call when the downstream AI request fails) so users are not
// charged a quota unit for a server-side error.
async function refund(uid) {
  const ref = db.doc(`aiQuota/${uid}`);
  const today = serverDay();
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data();
      if (data.date !== today) return;
      const next = Math.max(0, (data.count || 0) - 1);
      tx.set(ref, { date: today, count: next }, { merge: true });
    });
  } catch (e) {
    console.error("[checkQuota] refund failed:", e.message);
  }
}

// Express middleware: reserves a unit, exposes req.refundQuota() for the route.
async function checkQuota(req, res, next) {
  try {
    const result = await reserve(req.uid);
    if (!result.ok) {
      return res.status(429).json({
        success: false,
        error: "quota_exceeded",
        errorMessage: `Đã dùng hết ${result.limit} lượt AI hôm nay.`,
        limit: result.limit,
      });
    }
    req.quota = result;
    req.refundQuota = () => refund(req.uid);
    next();
  } catch (e) {
    console.error("[checkQuota] reserve failed:", e.message);
    // Fail-open would let abuse through; fail-closed is safer for cost control.
    return res
      .status(503)
      .json({ success: false, error: "quota_unavailable", errorMessage: "Không kiểm tra được hạn mức. Thử lại sau." });
  }
}

module.exports = { checkQuota, reserve, refund, serverDay, LIMIT };

const { db } = require("../firebase");

const ALLOWED_PLANS = new Set(["free", "plus", "pro", "coach_beta", "admin"]);

function normalizeTierField(tier) {
  const t = String(tier || "").toUpperCase();
  if (t === "PLUS") return "plus";
  if (t === "PRO" || t === "PRO_AI") return "pro";
  if (t === "COACH_BETA") return "coach_beta";
  if (t === "ADMIN") return "admin";
  return null;
}

async function resolvePlan(uid, claims) {
  if (claims && claims.admin === true) return "admin";
  const claimPlan = claims && claims.plan ? String(claims.plan).toLowerCase() : null;
  if (claimPlan && ALLOWED_PLANS.has(claimPlan)) return claimPlan;

  try {
    const snap = await db.doc(`users/${uid}/tier/current`).get();
    if (snap.exists) {
      const fromTier = normalizeTierField(snap.get("tier"));
      if (fromTier) return fromTier;
    }
  } catch (e) {
    console.error("[planResolver] tier lookup failed:", e.message);
  }
  return "free";
}

module.exports = { resolvePlan, ALLOWED_PLANS };

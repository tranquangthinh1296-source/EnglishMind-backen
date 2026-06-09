// T37-BE — Verify the Firebase ID token sent by the client and confirm the
// caller is actually entitled to the Pro AI proxy before any Gemini call.
//
// Client sends:  Authorization: Bearer <Firebase ID token>
// (see EnglishMindRepository.callGeminiJson + ContentApiService.generateAiPro)
const { auth, db } = require("../firebase");

// Pull "Bearer <token>" → "<token>".
function extractToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length ? token : null;
}

// A user is entitled if they are an admin (custom claim) OR have an active
// Pro/Lifetime tier recorded in Firestore at users/{uid}/tier/current.
async function hasEntitlement(uid, claims) {
  if (claims && claims.admin === true) return true;
  try {
    const snap = await db.doc(`users/${uid}/tier/current`).get();
    if (!snap.exists) return false;
    const tier = snap.get("tier");
    return tier === "PRO" || tier === "LIFETIME" || tier === "PRO_AI";
  } catch (e) {
    console.error("[verifyAuth] tier lookup failed:", e.message);
    return false;
  }
}

async function verifyAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: "missing_token", errorMessage: "Thiếu Authorization Bearer token." });
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch (e) {
    return res
      .status(401)
      .json({ success: false, error: "invalid_token", errorMessage: "Token không hợp lệ hoặc đã hết hạn." });
  }

  const entitled = await hasEntitlement(decoded.uid, decoded);
  if (!entitled) {
    return res
      .status(403)
      .json({ success: false, error: "no_entitlement", errorMessage: "Tài khoản chưa có quyền Pro AI." });
  }

  req.uid = decoded.uid;
  req.claims = decoded;
  next();
}

module.exports = { verifyAuth };

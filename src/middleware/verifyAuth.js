// Verify Firebase ID token and attach trusted plan (AI-SAFE-3).
const { auth } = require("../firebase");
const { resolvePlan } = require("./planResolver");

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length ? token : null;
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

  const plan = await resolvePlan(decoded.uid, decoded);
  req.uid = decoded.uid;
  req.claims = decoded;
  req.plan = plan;
  next();
}

module.exports = { verifyAuth };

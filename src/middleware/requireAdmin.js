const { auth } = require("../firebase");

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length ? token : null;
}

async function requireAdmin(req, res, next) {
  let decoded = req.claims || null;
  if (!decoded) {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, error: "missing_token" });
    }
    try {
      decoded = await auth.verifyIdToken(token);
    } catch {
      return res.status(401).json({ success: false, error: "invalid_token" });
    }
  }
  if (decoded.admin !== true) {
    return res.status(403).json({ success: false, error: "forbidden" });
  }
  req.uid = decoded.uid;
  req.claims = decoded;
  next();
}

module.exports = { requireAdmin, extractToken };

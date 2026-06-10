const crypto = require("crypto");

const PATTERNS = {
  email: /[\w.+-]+@[\w-]+\.[\w.]{2,}/,
  phone_vn: /(\+?84|0)(\d[\s.]?){8,10}\d/,
  money: /\d[\d.,]*\s*(tỷ|ty|triệu|trieu|tr\b|k\b|vnd|vnđ|đ\b|dong|usd|\$)/i,
  contract_number: /(hợp đồng|hop dong|contract|HĐ|HD)[\s:#\-]*[\w\/]*\d+/i,
  project_name: /(dự án|du an|project)\s+[A-ZÀ-Ỹ][\w\sÀ-ỹ]{2,30}/,
  address: /(số|so)\s+\d+[\w\/]*\s+(đường|duong|street|phố|pho)/i,
};

const BLOCKED_TYPES = new Set(["email", "phone_vn", "money", "contract_number"]);
const PRIVATE_ONLY_TYPES = new Set(["project_name", "address", "long_sensitive_text"]);

function detectTypes(text) {
  const detected = [];
  if (!text || typeof text !== "string") return detected;

  for (const [type, regex] of Object.entries(PATTERNS)) {
    if (regex.test(text)) detected.push(type);
  }
  if (text.length > 600) detected.push("long_sensitive_text");
  return detected;
}

function mapPrivacyLevel(detectedTypes) {
  if (detectedTypes.some((t) => BLOCKED_TYPES.has(t))) return "blocked_sensitive";
  if (detectedTypes.some((t) => PRIVATE_ONLY_TYPES.has(t))) return "private";
  return "safe_to_template";
}

function classify(text) {
  const detectedTypes = detectTypes(text);
  return {
    privacyLevel: mapPrivacyLevel(detectedTypes),
    detectedTypes,
  };
}

async function classifyAndLog(pool, text) {
  const { privacyLevel, detectedTypes } = classify(text);
  const inputHash = crypto.createHash("sha256").update(text || "", "utf8").digest("hex");
  await pool.query(
    `INSERT INTO privacy_redaction_log (input_hash, detected_sensitive_types, privacy_level, action)
     VALUES ($1, $2, $3, 'classified')`,
    [inputHash, detectedTypes, privacyLevel]
  );
  return { privacyLevel, detectedTypes, inputHash };
}

module.exports = { classify, classifyAndLog, detectTypes, mapPrivacyLevel, PATTERNS };

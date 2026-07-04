// Content endpoints — reads from Firestore (our cloud backup).
// Auto-seeds curriculum structure from built-in topic data on first run.
// Architecture: Firestore is source of truth; no CONTENT_UPSTREAM_URL needed.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { db } = require("../firebase");
const { generate } = require("../gemini");
const { verifyAuth } = require("../middleware/verifyAuth");
const { requireAdmin } = require("../middleware/requireAdmin");
const { costGuard } = require("../middleware/costGuard");
const { createUidLimiter } = require("../middleware/rateLimits");

const router = express.Router();
const towerUidLimiter = createUidLimiter("RATE_TOWER_UID_5M", 20);

const contentWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.CONTENT_WRITE_RATE_LIMIT || 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "rate_limited" },
});

function normalizeWordParam(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9'-]+|[^a-z0-9'-]+$/g, "");
  if (!/^[a-z][a-z'-]{0,63}$/.test(value)) return null;
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeId(value, max = 128) {
  return typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function isFiniteInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validateProgressBody(body) {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_body" };
  if (!isSafeId(body.lessonId)) return { ok: false, error: "invalid_lesson_id" };
  if (typeof body.status !== "string" || body.status.length < 1 || body.status.length > 32) {
    return { ok: false, error: "invalid_status" };
  }
  if (!isFiniteInteger(body.score, 0, 100)) return { ok: false, error: "invalid_score" };
  if (!Number.isFinite(body.timestamp) || body.timestamp <= 0) {
    return { ok: false, error: "invalid_timestamp" };
  }
  return { ok: true };
}

function validateLessonBody(body) {
  if (!isPlainObject(body)) return { ok: false, error: "invalid_body" };
  if (!isSafeId(body.id)) return { ok: false, error: "invalid_lesson_id" };
  if (!isFiniteInteger(body.level, 1, 100)) return { ok: false, error: "invalid_level" };
  if (typeof body.title !== "string" || body.title.length < 1 || body.title.length > 200) {
    return { ok: false, error: "invalid_title" };
  }
  if (typeof body.lessonType !== "string" || body.lessonType.length < 1 || body.lessonType.length > 64) {
    return { ok: false, error: "invalid_lesson_type" };
  }
  if (!isFiniteInteger(body.durationMin, 1, 240)) return { ok: false, error: "invalid_duration" };
  if (!isFiniteInteger(body.passingScore, 0, 100)) return { ok: false, error: "invalid_passing_score" };
  if (typeof body.cefrLevel !== "string" || body.cefrLevel.length < 1 || body.cefrLevel.length > 16) {
    return { ok: false, error: "invalid_cefr_level" };
  }
  if (body.contentJson != null && !isPlainObject(body.contentJson)) {
    return { ok: false, error: "invalid_content_json" };
  }
  if (body.conceptsJson != null && !Array.isArray(body.conceptsJson)) {
    return { ok: false, error: "invalid_concepts_json" };
  }
  if (body.vocabJson != null && !Array.isArray(body.vocabJson)) {
    return { ok: false, error: "invalid_vocab_json" };
  }
  if (body.quizJson != null && !isPlainObject(body.quizJson)) {
    return { ok: false, error: "invalid_quiz_json" };
  }
  return { ok: true };
}

// ── Seed data (mirrors app assets) ────────────────────────────────────────────

const CURRICULA_SEED = [
  {
    id: "qs_curr",
    domain: "QS",
    title: "Tiếng Anh Chuyên Ngành Đo Lường (QS)",
    description: "Từ vựng và kỹ năng tiếng Anh chuyên ngành Quantity Surveying từ cơ bản đến nâng cao.",
    totalUnits: 20,
    version: 1,
  },
  {
    id: "arch_curr",
    domain: "ARCHITECTURE",
    title: "Tiếng Anh Chuyên Ngành Kiến Trúc",
    description: "Từ vựng và kỹ năng tiếng Anh chuyên ngành Kiến trúc từ A2 đến C1.",
    totalUnits: 20,
    version: 1,
  },
  {
    id: "interior_curr",
    domain: "INTERIOR",
    title: "Tiếng Anh Chuyên Ngành Nội Thất",
    description: "Từ vựng và kỹ năng tiếng Anh chuyên ngành Thiết kế Nội thất.",
    totalUnits: 20,
    version: 1,
  },
];

const UNITS_SEED = {
  qs_curr: [
    { id:"qs_u1",  level:1, orderInLevel:1,  title:"Introduction to Quantity Surveying", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u2",  level:1, orderInLevel:2,  title:"Units of Measurement", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u3",  level:1, orderInLevel:3,  title:"Reading Architectural Drawings", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"qs_u4",  level:1, orderInLevel:4,  title:"Reading Structural Drawings", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"qs_u5",  level:1, orderInLevel:5,  title:"Take-off Process & Methodology", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u6",  level:2, orderInLevel:1,  title:"Standard Methods of Measurement", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"qs_u7",  level:2, orderInLevel:2,  title:"Substructure Measurement", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u8",  level:2, orderInLevel:3,  title:"Superstructure Concrete", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u9",  level:2, orderInLevel:4,  title:"Masonry and Blockwork", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u10", level:2, orderInLevel:5,  title:"Finishes (Wall, Floor, Ceiling)", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"qs_u11", level:3, orderInLevel:1,  title:"Bill of Quantities (BoQ) Structure", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"qs_u12", level:3, orderInLevel:2,  title:"Pricing the BoQ", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"qs_u13", level:3, orderInLevel:3,  title:"Tendering Process", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"qs_u14", level:3, orderInLevel:4,  title:"Contract Types", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"qs_u15", level:3, orderInLevel:5,  title:"Interim Valuations", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"qs_u16", level:4, orderInLevel:1,  title:"Variations and Change Orders", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"qs_u17", level:4, orderInLevel:2,  title:"Claims and Disputes", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"qs_u18", level:4, orderInLevel:3,  title:"Value Engineering", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"qs_u19", level:4, orderInLevel:4,  title:"Final Account Settlement", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"qs_u20", level:4, orderInLevel:5,  title:"Cost Reporting and Forecasting", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
  ],
  arch_curr: [
    { id:"arch_u1",  level:1, orderInLevel:1,  title:"Introduction to Architecture", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"A2" },
    { id:"arch_u2",  level:1, orderInLevel:2,  title:"Architectural Drawing Basics", lessonType:"READING", durationMin:20, cefrLevel:"A2" },
    { id:"arch_u3",  level:1, orderInLevel:3,  title:"Building Elements — Structure", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"A2" },
    { id:"arch_u4",  level:1, orderInLevel:4,  title:"Building Elements — Envelope", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"arch_u5",  level:1, orderInLevel:5,  title:"Spatial Terminology", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"arch_u6",  level:2, orderInLevel:1,  title:"Design Process & Briefing", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"arch_u7",  level:2, orderInLevel:2,  title:"Site Analysis", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"arch_u8",  level:2, orderInLevel:3,  title:"Structural Systems", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"arch_u9",  level:2, orderInLevel:4,  title:"Materials & Finishes", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"arch_u10", level:2, orderInLevel:5,  title:"Building Regulations & Codes", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"arch_u11", level:3, orderInLevel:1,  title:"Construction Documentation", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"arch_u12", level:3, orderInLevel:2,  title:"Mechanical & Electrical Systems", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"arch_u13", level:3, orderInLevel:3,  title:"Sustainable Design", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"arch_u14", level:3, orderInLevel:4,  title:"Project Delivery Methods", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"arch_u15", level:3, orderInLevel:5,  title:"Client Presentations", lessonType:"SPEAKING", durationMin:20, cefrLevel:"B2" },
    { id:"arch_u16", level:4, orderInLevel:1,  title:"Urban Design & Planning", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"arch_u17", level:4, orderInLevel:2,  title:"Conservation & Heritage", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"arch_u18", level:4, orderInLevel:3,  title:"BIM & Digital Tools", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"C1" },
    { id:"arch_u19", level:4, orderInLevel:4,  title:"Professional Practice", lessonType:"READING", durationMin:20, cefrLevel:"C1" },
    { id:"arch_u20", level:4, orderInLevel:5,  title:"Report Writing for Architects", lessonType:"WRITING", durationMin:25, cefrLevel:"C1" },
  ],
  interior_curr: [
    { id:"int_u1",  level:1, orderInLevel:1,  title:"Introduction to Interior Design", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"A2" },
    { id:"int_u2",  level:1, orderInLevel:2,  title:"Space Planning & Zoning", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"A2" },
    { id:"int_u3",  level:1, orderInLevel:3,  title:"Colour Theory & Palettes", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"A2" },
    { id:"int_u4",  level:1, orderInLevel:4,  title:"Furniture & Fixtures Vocabulary", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"int_u5",  level:1, orderInLevel:5,  title:"Lighting Design Basics", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"int_u6",  level:2, orderInLevel:1,  title:"Materials & Textures", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"int_u7",  level:2, orderInLevel:2,  title:"Reading Interior Drawings", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"int_u8",  level:2, orderInLevel:3,  title:"Client Briefing & Concept", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"int_u9",  level:2, orderInLevel:4,  title:"Design Styles & Movements", lessonType:"READING", durationMin:20, cefrLevel:"B1" },
    { id:"int_u10", level:2, orderInLevel:5,  title:"FF&E Specification", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B1" },
    { id:"int_u11", level:3, orderInLevel:1,  title:"Project Management Basics", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"int_u12", level:3, orderInLevel:2,  title:"Budgeting & Cost Control", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"int_u13", level:3, orderInLevel:3,  title:"Sustainable Interiors", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"int_u14", level:3, orderInLevel:4,  title:"Presentation Skills", lessonType:"SPEAKING", durationMin:20, cefrLevel:"B2" },
    { id:"int_u15", level:3, orderInLevel:5,  title:"Building Codes for Interiors", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"int_u16", level:4, orderInLevel:1,  title:"Commercial Interior Projects", lessonType:"READING", durationMin:20, cefrLevel:"B2" },
    { id:"int_u17", level:4, orderInLevel:2,  title:"Hospitality & Retail Design", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"B2" },
    { id:"int_u18", level:4, orderInLevel:3,  title:"BIM for Interior Designers", lessonType:"VOCABULARY", durationMin:15, cefrLevel:"C1" },
    { id:"int_u19", level:4, orderInLevel:4,  title:"Professional Ethics & Practice", lessonType:"READING", durationMin:20, cefrLevel:"C1" },
    { id:"int_u20", level:4, orderInLevel:5,  title:"Portfolio & Proposal Writing", lessonType:"WRITING", durationMin:25, cefrLevel:"C1" },
  ],
};

// ── Seed helper ──────────────────────────────────────────────────────────────

let seedDone = false;

async function ensureSeeded() {
  if (seedDone) return;
  try {
    const snap = await db.collection("curricula").limit(1).get();
    if (!snap.empty) { seedDone = true; return; }

    const batch = db.batch();
    for (const curr of CURRICULA_SEED) {
      const ref = db.collection("curricula").doc(curr.id);
      batch.set(ref, curr);
      const units = UNITS_SEED[curr.id] || [];
      for (const unit of units) {
        batch.set(ref.collection("units").doc(unit.id), unit);
      }
    }
    await batch.commit();
    console.log("[content] Firestore seeded with curriculum data.");
    seedDone = true;
  } catch (e) {
    console.error("[content] Seed error:", e.message);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get("/curricula", async (_req, res) => {
  await ensureSeeded();
  try {
    const snap = await db.collection("curricula").get();
    const data = snap.docs
      .map(d => d.data())
      .filter(item =>
        typeof item.id === "string" &&
        typeof item.domain === "string" &&
        typeof item.title === "string" &&
        typeof item.description === "string" &&
        Number.isInteger(item.totalUnits) &&
        Number.isInteger(item.version)
      );
    res.json(data);
  } catch (e) {
    console.error("[content] GET /curricula:", e.message);
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.get("/curriculum/:id", async (req, res) => {
  await ensureSeeded();
  try {
    const ref = db.collection("curricula").doc(req.params.id);
    const [doc, unitsSnap] = await Promise.all([ref.get(), ref.collection("units").orderBy("level").get()]);
    if (!doc.exists) return res.status(404).json({ success: false, error: "not_found" });
    const units = unitsSnap.docs.map(d => d.data());
    res.json({ ...doc.data(), units });
  } catch (e) {
    console.error("[content] GET /curriculum/:id:", e.message);
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.get("/lesson/:id", async (req, res) => {
  try {
    const doc = await db.collection("lessons").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: "not_found" });
    res.json(doc.data());
  } catch (e) {
    console.error("[content] GET /lesson/:id:", e.message);
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.get("/vocabulary", async (req, res) => {
  try {
    const { cefr, limit = "50" } = req.query;
    let query = db.collection("vocabulary").limit(parseInt(limit, 10));
    if (cefr) query = query.where("cefrLevel", "==", cefr);
    const snap = await query.get();
    res.json(snap.docs.map(d => d.data()));
  } catch (e) {
    console.error("[content] GET /vocabulary:", e.message);
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.get("/word/:word", async (req, res) => {
  const word = normalizeWordParam(req.params.word);
  if (!word) {
    return res.status(400).json({ success: false, error: "invalid_word" });
  }

  try {
    const doc = await db.collection("words").doc(word).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: "not_found", word });
    res.json(doc.data());
  } catch (e) {
    console.error("[content] GET /word:", e.message);
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});
// ── Vocab Tower: on-demand floor generation ──────────────────────────────────
// Each floor is generated ONCE (one Gemini call), cached in Firestore
// `tower_floors/{mode}_{floor}` and served to every user from then on.
// The client downloads one floor at a time (round-by-round), so neither the
// app bundle nor the user's token budget grows.

const TOWER_THEMES = {
  GENERAL: [
    "Chào hỏi & Mô tả cơ bản", "Gia đình & Xã hội thường nhật",
    "Dịch vụ ẩm thực & Ăn uống", "Du lịch, Phương tiện & Bản đồ",
    "Học tập, Trường học & Kỹ năng", "Công việc & Giao tiếp công sở",
    "Sức khỏe, Thể thao & Lối sống", "Điện ảnh, Nghệ thuật & Bản sắc",
    "Công nghệ thông tin & Đổi mới", "Kinh doanh, Tài chính & Triết lý",
  ],
  SPECIALIZATION_QS: [
    "Đo bóc & Lấy khối lượng", "Bảng tiên lượng BoQ & Vật liệu",
    "Quản lý chi phí dự án", "Chi phí trực tiếp & gián tiếp",
    "Hồ sơ mời thầu & Đấu thầu", "Hợp đồng & Điều kiện FIDIC",
    "Tranh chấp & Lệnh thay đổi (VO)", "Thanh toán đợt & Nghiệm thu",
    "Kháng nghị & Trọng tài", "Quyết toán & Đối chiếu số liệu",
  ],
  SPECIALIZATION_ARCH: [
    "Nhập môn kiến trúc & Bản vẽ", "Cấu kiện công trình & Kết cấu",
    "Vỏ bao che & Vật liệu", "Quy trình thiết kế & Briefing",
    "Phân tích khu đất & Quy hoạch", "Hệ kết cấu & MEP",
    "Hồ sơ thi công & Quy chuẩn", "Thiết kế bền vững",
    "BIM & Công cụ số", "Hành nghề & Thuyết trình với khách hàng",
  ],
  SPECIALIZATION_INTERIOR: [
    "Nhập môn thiết kế nội thất", "Quy hoạch không gian & Zoning",
    "Màu sắc & Bảng vật liệu", "Đồ nội thất & FF&E",
    "Thiết kế chiếu sáng", "Đọc bản vẽ nội thất",
    "Briefing & Concept với khách", "Quản lý dự án & Ngân sách",
    "Nội thất thương mại & Khách sạn", "Hồ sơ năng lực & Đề xuất",
  ],
};

const TOWER_MODE_BRIEF = {
  GENERAL:
    "tiếng Anh GIAO TIẾP thông dụng hằng ngày. Bắt buộc trộn: từ đơn (WORD), " +
    "cụm từ/phrasal verbs/collocations (PHRASE) và các CÁCH DIỄN ĐẠT Ý tự nhiên " +
    "người bản xứ hay dùng (PHRASE), cùng động từ thiết yếu (VERB).",
  SPECIALIZATION_QS:
    "tiếng Anh chuyên ngành Quantity Surveying (QS): đo bóc khối lượng, BoQ, " +
    "hợp đồng FIDIC, chi phí, đấu thầu, thanh toán, quyết toán xây dựng.",
  SPECIALIZATION_ARCH:
    "tiếng Anh chuyên ngành Kiến trúc: thiết kế, bản vẽ, cấu kiện, vật liệu, " +
    "quy chuẩn xây dựng, BIM, hành nghề kiến trúc sư.",
  SPECIALIZATION_INTERIOR:
    "tiếng Anh chuyên ngành Thiết kế Nội thất: không gian, vật liệu hoàn thiện, " +
    "FF&E, chiếu sáng, concept, làm việc với khách hàng.",
};

function towerCefrForFloor(floor) {
  if (floor <= 20) return "A1-A2";
  if (floor <= 60) return "A2-B1";
  return "B1-C1";
}

function towerThemeForFloor(mode, floor) {
  const list = TOWER_THEMES[mode] || TOWER_THEMES.GENERAL;
  return list[Math.min(Math.floor((floor - 1) / 10), 9)];
}

const TOWER_UNIT_SCHEMA = {
  type: "OBJECT",
  properties: {
    units: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", description: "WORD | PHRASE | VERB | QA | SCENARIO" },
          content: { type: "STRING", description: "English word/phrase/expression, or question text for QA/SCENARIO" },
          ipa: { type: "STRING" },
          meaningVi: { type: "STRING" },
          meaningEn: { type: "STRING", description: "For QA: the correct English answer" },
          partOfSpeech: { type: "STRING" },
          exampleEn: { type: "STRING" },
          exampleVi: { type: "STRING" },
          options: { type: "ARRAY", items: { type: "STRING" }, description: "SCENARIO only: exactly 3 answer options" },
          correctOptionIndex: { type: "INTEGER", description: "SCENARIO only: 0-based index of the correct option" },
        },
        required: ["type", "content", "meaningVi", "exampleEn", "exampleVi"],
      },
    },
  },
  required: ["units"],
};

async function generateTowerFloor(towerMode, floorNumber) {
  const theme = towerThemeForFloor(towerMode, floorNumber);
  const cefr = towerCefrForFloor(floorNumber);
  const isGeneral = towerMode === "GENERAL";
  const mix = isGeneral
    ? "Đúng 30 unit: 14 WORD, 12 PHRASE (cụm từ, collocation, cách diễn đạt ý), 4 VERB."
    : "Đúng 30 unit: 15 WORD, 8 PHRASE, 4 VERB, 2 QA (câu hỏi chuyên môn + đáp án trong meaningEn), 1 SCENARIO (tình huống thực tế, 3 options, correctOptionIndex).";

  const prompt =
    `Tạo nội dung tầng ${floorNumber}/100 của tháp từ vựng về ${TOWER_MODE_BRIEF[towerMode]}\n` +
    `Chủ đề tầng: ${theme}. Trình độ CEFR: ${cefr} (tầng càng cao càng khó dần).\n` +
    `${mix}\n` +
    `Mỗi unit có nghĩa tiếng Việt tự nhiên, IPA, câu ví dụ thực tế EN + bản dịch VI. Không trùng lặp nội dung.`;

  const { text } = await generate({
    prompt,
    systemInstruction:
      "Bạn là chuyên gia thiết kế giáo trình tiếng Anh cho người Việt. Trả về JSON đúng schema.",
    schemaJson: TOWER_UNIT_SCHEMA,
  });

  const parsed = JSON.parse(text);
  const units = (parsed.units || []).slice(0, 30).map((u, idx) => ({
    id: `${towerMode}_${floorNumber}_${idx}`,
    type: u.type || "WORD",
    content: u.content,
    ipa: u.ipa || "",
    meaningVi: u.meaningVi || "",
    meaningEn: u.meaningEn || "",
    partOfSpeech: u.partOfSpeech || (u.type === "PHRASE" ? "PHRASE" : "NOUN"),
    exampleEn: u.exampleEn || "",
    exampleVi: u.exampleVi || "",
    frequencyRank: idx + 1,
    questionData: Array.isArray(u.options) && u.options.length > 0 ? JSON.stringify(u.options) : null,
    correctAnswer: u.correctOptionIndex != null ? String(u.correctOptionIndex) : null,
  }));

  if (units.length === 0) throw new Error("Gemini returned no units");
  return { floorNumber, towerMode, theme, cefrLevel: cefr, units };
}

// De-duplicate concurrent generation requests for the same floor.
const towerGenInFlight = new Map();

router.get("/v1/tower/:towerMode/:floorNumber", verifyAuth, towerUidLimiter, costGuard, async (req, res) => {
  const towerMode = req.params.towerMode;
  const floorNumber = parseInt(req.params.floorNumber, 10);
  if (!TOWER_THEMES[towerMode] || !(floorNumber >= 1 && floorNumber <= 100)) {
    return res.status(400).json({ status: "bad_request", data: null });
  }
  const id = `${towerMode}_${floorNumber}`;
  try {
    const doc = await db.collection("tower_floors").doc(id).get();
    if (doc.exists) return res.json({ status: "success", data: doc.data() });

    // Not cached yet → generate once and persist for everyone.
    let pending = towerGenInFlight.get(id);
    if (!pending) {
      pending = generateTowerFloor(towerMode, floorNumber)
        .then(async (data) => {
          await db.collection("tower_floors").doc(id).set({ ...data, generatedAt: Date.now() });
          return data;
        })
        .finally(() => towerGenInFlight.delete(id));
      towerGenInFlight.set(id, pending);
    }
    const data = await pending;
    res.json({ status: "success", data });
  } catch (e) {
    console.error(`[content] tower ${id}:`, e.message);
    res.status(500).json({ status: "error", data: null });
  }
});

router.post("/progress", contentWriteLimiter, verifyAuth, async (req, res) => {
  const validation = validateProgressBody(req.body);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: validation.error });
  }

  try {
    const { lessonId, status, score, timestamp } = req.body;
    await db.collection("progress").add({
      uid: req.uid,
      lessonId,
      status,
      score,
      timestamp,
      serverTimestamp: Date.now(),
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.post("/lesson", contentWriteLimiter, verifyAuth, requireAdmin, async (req, res) => {
  const validation = validateLessonBody(req.body);
  if (!validation.ok) {
    return res.status(400).json({ success: false, error: validation.error });
  }

  try {
    const lesson = req.body;
    await db.collection("lessons").doc(lesson.id).set(
      {
        ...lesson,
        updatedBy: req.uid,
        serverTimestamp: Date.now(),
      },
      { merge: true },
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

module.exports = router;
module.exports.normalizeWordParam = normalizeWordParam;

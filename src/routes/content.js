// Content endpoints — reads from Firestore (our cloud backup).
// Auto-seeds curriculum structure from built-in topic data on first run.
// Architecture: Firestore is source of truth; no CONTENT_UPSTREAM_URL needed.
const express = require("express");
const { db } = require("../firebase");

const router = express.Router();

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
    const data = snap.docs.map(d => d.data());
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
  try {
    const doc = await db.collection("words").doc(req.params.word.toLowerCase()).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: "not_found" });
    res.json(doc.data());
  } catch (e) {
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.get("/v1/tower/:towerMode/:floorNumber", async (req, res) => {
  try {
    const { towerMode, floorNumber } = req.params;
    const id = `${towerMode}_${floorNumber}`;
    const doc = await db.collection("tower_floors").doc(id).get();
    if (!doc.exists) return res.status(404).json({ status: "not_found", data: null });
    res.json({ status: "ok", data: doc.data() });
  } catch (e) {
    res.status(500).json({ status: "error", data: null });
  }
});

router.post("/progress", async (req, res) => {
  try {
    await db.collection("progress").add({ ...req.body, serverTimestamp: Date.now() });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

router.post("/lesson", async (req, res) => {
  try {
    const lesson = req.body || {};
    if (lesson.id) {
      await db.collection("lessons").doc(lesson.id).set(lesson, { merge: true });
    } else {
      await db.collection("lessons").add(lesson);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "firestore_error" });
  }
});

module.exports = router;

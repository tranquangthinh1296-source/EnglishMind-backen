/**
 * Firestore store for Ralph loop remote control — single-doc MVP (no composite indexes).
 * Doc: loopStatus/default
 */

const { db } = require("../firebase");

const WORKSPACE = "default";
const DOC_PATH = `loopStatus/${WORKSPACE}`;
const MAX_MESSAGES = 50;
const MAX_PENDING = 20;

let _inject = null;

function setStoreForTest(store) {
  _inject = store;
}

function getDb() {
  if (_inject && _inject.db) return _inject.db;
  return db;
}

function docRef() {
  if (_inject && _inject.docRef) return _inject.docRef;
  return db.doc(DOC_PATH);
}

function emptyDoc() {
  return {
    workspaceId: WORKSPACE,
    bridgeOnline: false,
    lastSeenAt: null,
    branch: null,
    agent: null,
    iteration: null,
    tasks: null,
    quota: null,
    gutter: null,
    metrics: null,
    tokens: null,
    hostname: null,
    messageLog: [],
    pendingCommands: [],
  };
}

async function readDoc() {
  const snap = await docRef().get();
  if (!snap.exists) return emptyDoc();
  const d = snap.data() || {};
  const lastSeen = d.lastSeenAt && typeof d.lastSeenAt.toDate === "function" ? d.lastSeenAt.toDate() : null;
  const bridgeOnline = lastSeen != null && Date.now() - lastSeen.getTime() < 45_000;
  return {
    ...emptyDoc(),
    ...d,
    bridgeOnline,
    lastSeenAt: lastSeen ? lastSeen.toISOString() : d.lastSeenAt || null,
    messageLog: Array.isArray(d.messageLog) ? d.messageLog : [],
    pendingCommands: Array.isArray(d.pendingCommands) ? d.pendingCommands : [],
  };
}

async function writeStatus(statusFields) {
  const ref = docRef();
  const now = new Date();
  await ref.set(
    {
      ...statusFields,
      workspaceId: WORKSPACE,
      lastSeenAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
}

async function readStatus() {
  const d = await readDoc();
  const { messageLog, pendingCommands, ...status } = d;
  return status;
}

async function listMessages(limit = 40) {
  const d = await readDoc();
  return d.messageLog.slice(-limit);
}

async function appendMessage({ role, text, meta = {} }) {
  const ref = docRef();
  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    role,
    text: String(text || "").slice(0, 4000),
    meta,
    createdAt: new Date().toISOString(),
  };
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : emptyDoc();
    const log = Array.isArray(cur.messageLog) ? [...cur.messageLog, entry] : [entry];
    while (log.length > MAX_MESSAGES) log.shift();
    tx.set(ref, { messageLog: log, updatedAt: new Date() }, { merge: true });
  });
  return entry;
}

async function enqueueCommand({ type, text, payload, createdBy }) {
  const ref = docRef();
  const id = `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = {
    id,
    type,
    text: String(text || "").slice(0, 2000),
    payload: payload || {},
    status: "pending",
    createdBy: createdBy || "admin",
    createdAt: new Date().toISOString(),
  };
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : emptyDoc();
    const pending = Array.isArray(cur.pendingCommands) ? [...cur.pendingCommands, entry] : [entry];
    while (pending.length > MAX_PENDING) pending.shift();
    tx.set(ref, { pendingCommands: pending, updatedAt: new Date() }, { merge: true });
  });
  return entry;
}

async function listPendingCommands() {
  const d = await readDoc();
  return d.pendingCommands.filter((c) => c.status === "pending");
}

async function ackCommands(ids, result = "done") {
  if (!ids.length) return;
  const ref = docRef();
  const idSet = new Set(ids);
  await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const cur = snap.data();
    const pending = (cur.pendingCommands || []).map((c) =>
      idSet.has(c.id) ? { ...c, status: result, ackedAt: new Date().toISOString() } : c,
    );
    tx.set(ref, { pendingCommands: pending, updatedAt: new Date() }, { merge: true });
  });
}

module.exports = {
  WORKSPACE,
  readStatus,
  writeStatus,
  appendMessage,
  listMessages,
  enqueueCommand,
  listPendingCommands,
  ackCommands,
  setStoreForTest,
};

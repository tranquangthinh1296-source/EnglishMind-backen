const crypto = require("crypto");

const sessions = new Map();

function datePart(now = new Date()) {
  return now.toISOString().slice(0, 10).replace(/-/g, "");
}

function makeSessionId(now = new Date()) {
  return `vl_${datePart(now)}_${crypto.randomBytes(6).toString("hex")}`;
}

function create({ uid, mode, maxSessionSeconds, now = Date.now() }) {
  const sessionId = makeSessionId(new Date(now));
  const createdAt = now;
  const expiresAt = now + Math.max(1, Math.floor(maxSessionSeconds || 180)) * 1000;
  const meta = {
    sessionId,
    uid,
    mode,
    createdAt,
    expiresAt,
    chargedSeconds: 0,
  };
  sessions.set(sessionId, meta);
  return { ...meta };
}

function get(sessionId) {
  const meta = sessions.get(sessionId);
  if (!meta) return null;
  if (meta.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { ...meta };
}

function close(sessionId, chargedSeconds = 0) {
  const meta = sessions.get(sessionId);
  if (!meta) return null;
  const closed = {
    ...meta,
    chargedSeconds: Math.max(0, Math.floor(Number(chargedSeconds) || 0)),
  };
  sessions.delete(sessionId);
  return closed;
}

function sweepExpired(now = Date.now()) {
  let removed = 0;
  for (const [id, meta] of sessions.entries()) {
    if (meta.expiresAt <= now) {
      sessions.delete(id);
      removed += 1;
    }
  }
  return removed;
}

function __resetForTest() {
  sessions.clear();
}

module.exports = {
  create,
  get,
  close,
  sweepExpired,
  __resetForTest,
};

// Optional Redis hot-cache layer using Node built-ins only. Missing REDIS_URL is
// a supported state: callers get null/no-op and keep their durable fallback path.
const net = require("net");
const tls = require("tls");

const DEFAULT_TIMEOUT_MS = 1500;

let warnedUnavailable = false;

function isRedisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

function warnOnce(message) {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(message);
}

function encodeCommand(parts) {
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    chunks.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }
  return chunks.join("");
}

// A reply may arrive split across TCP chunks; return INCOMPLETE to wait for more data.
// Bulk-string ($) lengths are BYTE counts, so slice on the Buffer, not the decoded string.
const INCOMPLETE = Symbol("incomplete");

function parseResp(buffer) {
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd === -1 || buffer.length === 0) return INCOMPLETE;
  const type = String.fromCharCode(buffer[0]);
  const head = buffer.toString("utf8", 1, lineEnd);
  if (type === "+") return head;
  if (type === "-") throw new Error(head);
  if (type === ":") return Number(head);
  if (type !== "$") return null;
  const len = Number(head);
  if (!Number.isFinite(len) || len < 0) return null;
  if (buffer.length < lineEnd + 2 + len + 2) return INCOMPLETE;
  return buffer.toString("utf8", lineEnd + 2, lineEnd + 2 + len);
}

async function redisCommand(parts) {
  if (!isRedisConfigured()) return null;
  const url = new URL(process.env.REDIS_URL);
  const socketFactory = url.protocol === "rediss:" ? tls.connect : net.connect;
  const port = Number(url.port || (url.protocol === "rediss:" ? 6380 : 6379));
  const host = url.hostname;
  const password = decodeURIComponent(url.password || "");
  const username = decodeURIComponent(url.username || "");
  const db = url.pathname && url.pathname !== "/" ? url.pathname.slice(1) : "";
  const commands = [];
  if (password) {
    commands.push(username && username !== "default" ? ["AUTH", username, password] : ["AUTH", password]);
  }
  if (db) commands.push(["SELECT", db]);
  commands.push(parts);

  return new Promise((resolve) => {
    const socket = socketFactory({ host, port, servername: host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, Number(process.env.REDIS_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
    let data = Buffer.alloc(0);
    let commandIndex = 0;

    function finish(value) {
      clearTimeout(timer);
      socket.end();
      resolve(value);
    }

    socket.once(url.protocol === "rediss:" ? "secureConnect" : "connect", () => {
      socket.write(encodeCommand(commands[commandIndex]));
    });
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      let parsed;
      try {
        parsed = parseResp(data);
      } catch (e) {
        console.error("[redis] command failed:", e.message || e);
        finish(null);
        return;
      }
      if (parsed === INCOMPLETE) return; // wait for the rest of the reply
      commandIndex += 1;
      if (commandIndex >= commands.length) {
        finish(parsed);
        return;
      }
      data = Buffer.alloc(0);
      socket.write(encodeCommand(commands[commandIndex]));
    });
    socket.on("error", (err) => {
      warnOnce(`[redis] unavailable; cache disabled for this call: ${err.message || err}`);
      finish(null);
    });
  });
}

async function getCached(key) {
  if (!key) return null;
  try {
    const raw = await redisCommand(["GET", key]);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("[redis] get failed:", e.message || e);
    return null;
  }
}

async function setCached(key, value, ttlSeconds) {
  if (!key || value == null) return false;
  try {
    const parts = ["SET", key, JSON.stringify(value)];
    if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      parts.push("EX", Math.floor(ttlSeconds));
    }
    return (await redisCommand(parts)) === "OK";
  } catch (e) {
    console.error("[redis] set failed:", e.message || e);
    return false;
  }
}

module.exports = { isRedisConfigured, getCached, setCached };

const express = require("express");
const { requireAdmin } = require("../middleware/requireAdmin");
const loopOps = require("../services/loopOpsStore");

const router = express.Router();

function bridgeKey() {
  return process.env.LOOP_BRIDGE_SECRET || "";
}

function requireBridge(req, res, next) {
  const expected = bridgeKey();
  if (!expected) {
    return res.status(503).json({ success: false, error: "bridge_not_configured" });
  }
  const got = req.headers["x-loop-bridge-key"] || "";
  if (got !== expected) {
    return res.status(401).json({ success: false, error: "invalid_bridge_key" });
  }
  next();
}

const ALLOWED_COMMANDS = new Set(["chat", "steer", "pause", "resume", "start", "stop", "quota_watch"]);

router.post("/loop/bridge/sync", requireBridge, async (req, res) => {
  try {
    const body = req.body || {};
    const status = body.status || {};
    await loopOps.writeStatus(status);
    if (Array.isArray(body.messages)) {
      for (const m of body.messages.slice(0, 5)) {
        if (m && m.text) {
          await loopOps.appendMessage({
            role: m.role || "bridge",
            text: m.text,
            meta: m.meta || {},
          });
        }
      }
    }
    return res.json({ success: true });
  } catch (e) {
    console.error("[loop/bridge/sync]", e.message);
    return res.status(503).json({ success: false, error: "sync_failed" });
  }
});

router.get("/loop/bridge/commands", requireBridge, async (_req, res) => {
  try {
    const commands = await loopOps.listPendingCommands();
    return res.json({ success: true, data: { commands } });
  } catch (e) {
    console.error("[loop/bridge/commands]", e.message);
    return res.status(503).json({ success: false, error: "commands_unavailable" });
  }
});

router.post("/loop/bridge/ack", requireBridge, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length) await loopOps.ackCommands(ids, req.body?.result || "done");
    return res.json({ success: true });
  } catch (e) {
    console.error("[loop/bridge/ack]", e.message);
    return res.status(503).json({ success: false, error: "ack_failed" });
  }
});

router.get("/admin/loop/status", requireAdmin, async (_req, res) => {
  try {
    const [status, messages, commands] = await Promise.all([
      loopOps.readStatus(),
      loopOps.listMessages(50),
      loopOps.listPendingCommands(),
    ]);
    return res.json({
      success: true,
      data: { status, messages, pendingCommands: commands },
    });
  } catch (e) {
    console.error("[admin/loop/status]", e.message);
    return res.status(503).json({ success: false, error: "loop_status_unavailable" });
  }
});

router.post("/admin/loop/command", requireAdmin, async (req, res) => {
  try {
    const type = String(req.body?.type || "chat").toLowerCase();
    if (!ALLOWED_COMMANDS.has(type)) {
      return res.status(400).json({ success: false, error: "invalid_command_type" });
    }
    const text = String(req.body?.text || "").trim();
    if (!text && type === "chat") {
      return res.status(400).json({ success: false, error: "empty_message" });
    }
    const payload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};

    const cmd = await loopOps.enqueueCommand({
      type,
      text: text || type,
      payload,
      createdBy: req.uid || "admin",
    });

    await loopOps.appendMessage({
      role: "admin",
      text: text || `[${type}]`,
      meta: { commandId: cmd.id, type },
    });

    return res.json({ success: true, data: { command: cmd } });
  } catch (e) {
    console.error("[admin/loop/command]", e.message);
    return res.status(503).json({ success: false, error: "command_failed" });
  }
});

module.exports = router;

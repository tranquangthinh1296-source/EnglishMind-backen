const WebSocket = require("ws");
const { makeServerEvent } = require("./voiceProtocol");

const DEFAULT_TUTOR_MODEL = "gemini-3.1-flash-live-preview";
const DEFAULT_TRANSLATE_MODEL = "gemini-3.5-live-translate-preview";
const DEFAULT_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

function modelForMode(mode) {
  if (mode === "live_translate") {
    return process.env.VOICE_LIVE_TRANSLATE_MODEL || DEFAULT_TRANSLATE_MODEL;
  }
  return process.env.VOICE_LIVE_TUTOR_MODEL || DEFAULT_TUTOR_MODEL;
}

function mapClientEvent(event) {
  if (event.type === "audio.input") {
    return {
      realtimeInput: {
        mediaChunks: [{ mimeType: event.mimeType, data: event.data }],
      },
    };
  }
  if (event.type === "text.input") {
    return {
      clientContent: {
        turns: [{ role: "user", parts: [{ text: event.text }] }],
        turnComplete: false,
      },
    };
  }
  if (event.type === "barge_in") {
    return { realtimeInput: { activityStart: {} } };
  }
  if (event.type === "session.end") {
    return { clientContent: { turnComplete: true } };
  }
  return null;
}

function mapUpstreamEvent(raw) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return null;
  }

  if (parsed && typeof parsed.type === "string") {
    try {
      return makeServerEvent(parsed.type, parsed);
    } catch {
      return null;
    }
  }

  const text = parsed?.serverContent?.modelTurn?.parts?.find((part) => typeof part.text === "string")?.text;
  if (text) {
    return makeServerEvent("transcript.final", { speaker: "assistant", text });
  }
  return null;
}

function connect({ mode, sessionId, onEvent }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("gemini_api_key_missing");

  const endpoint = process.env.VOICE_LIVE_WS_URL || DEFAULT_ENDPOINT;
  const url = `${endpoint}?key=${encodeURIComponent(apiKey)}`;
  const upstream = new WebSocket(url);
  const pending = [
    {
      setup: {
        model: modelForMode(mode),
        generationConfig: { responseModalities: ["AUDIO"] },
      },
    },
  ];
  let open = false;
  let closed = false;
  let failed = false;
  const upstreamTimeoutMs = Math.max(1, Number(process.env.VOICE_LIVE_UPSTREAM_TIMEOUT_MS || 10_000));
  const openTimer = setTimeout(() => {
    emitUpstreamError();
    closeUpstream();
  }, upstreamTimeoutMs);

  function sendJson(payload) {
    if (!payload || closed) return;
    const serialized = JSON.stringify(payload);
    if (open && upstream.readyState === WebSocket.OPEN) {
      upstream.send(serialized);
    } else {
      pending.push(payload);
    }
  }

  function emitUpstreamError() {
    if (closed || failed) return;
    failed = true;
    onEvent(makeServerEvent("error", { code: "live_upstream_error", fallback: "classic" }));
  }

  function closeUpstream() {
    closed = true;
    clearTimeout(openTimer);
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  }

  upstream.on("open", () => {
    open = true;
    clearTimeout(openTimer);
    while (pending.length > 0) upstream.send(JSON.stringify(pending.shift()));
  });
  upstream.on("message", (data) => {
    const event = mapUpstreamEvent(data);
    if (event) onEvent(event);
  });
  upstream.on("error", () => {
    emitUpstreamError();
    closeUpstream();
  });
  upstream.on("close", () => {
    if (!closed) {
      emitUpstreamError();
      closeUpstream();
    }
  });

  return {
    send(event) {
      sendJson(mapClientEvent(event));
    },
    close() {
      closeUpstream();
    },
  };
}

module.exports = {
  connect,
  modelForMode,
};

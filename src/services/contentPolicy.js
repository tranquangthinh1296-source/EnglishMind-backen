// Rule-based content policy for AI gateway — education/translation scope only.
// No raw prompt in logs; callers log `code` only.

const PROMPT_MAX_BY_TASK = {
  // Transition (PROMPT-GOV-WEB-1): web still sends legacy taskTypes until NEXT_PUBLIC_NEW_TASKTYPES
  // flips — email under translate_core can reach ~4300 (2000 intent + 2000 recipient + metadata) and
  // conversation with context selectors ~1330. Keep these ceilings until the web flip ships, then
  // translate_core may return to 2500 and conversation_turn to 800.
  translate_core: 4600,
  word_lookup: 600,
  phonetics_on_demand: 400,
  reinforcement_on_demand: 800,
  speak_english_teacher: 600,
  speaking_pack_generation: 800,
  conversation_turn: 1400,
  scripted_dialogue: 1200,
  voice_analysis_short: 600,
  roadmap_generation: 2000,
  content_generation: 2000,
  // Web-Lite (PROMPT-GOV-WEB-1) — caps = web input clamps (webInputLimits.ts) + metadata wrapper.
  teacher_translate: 700, // 600 text + sourceLang/targetLang wrapper
  conversation_reply: 1400, // 600 context + 600 message + labels
  context_translate: 2500, // 2000 text + relationship/intent/tone/domain/level/length/depth lines
  email_write: 4600, // 2000 intent + 2000 recipient context + metadata lines
  email_rewrite: 8000, // previous subject+body (generated, long) + 2000 instruction + metadata
  reply_assistant: 1400, // 600 received message + 600 context + relationship/intent/tone/domain lines
};

const DEFAULT_PROMPT_MAX = 600;
const SYSTEM_INSTRUCTION_MAX = 12000;

const BLOCK_PATTERNS = [
  {
    code: "sexual_explicit",
    pattern:
      /\b(porn|porno|xxx|nude|nudes|onlyfans|sex toy|làm tình|quan hệ tình dục|ảnh nóng|clip nóng|gửi ảnh nóng)\b/i,
  },
  {
    code: "jailbreak",
    pattern:
      /ignore (all )?(previous|prior) instructions|jailbreak|dan mode|bypass safety|developer mode enabled|pretend you are not/i,
  },
  {
    code: "general_chatbox",
    pattern:
      /(viết code|write (a )?(python|javascript|java script)|giải phương trình|solve (this )?equation|chatgpt|gpt-4|bạn là ai\?|who are you\?|thời tiết hôm nay|weather today|viết email marketing|write a poem about)/i,
  },
  {
    code: "violence_illegal",
    pattern: /\b(cách giết|cách làm bom|buy gun|mua súng|kill (him|her)|đâm chết|ma túy|drug deal)\b/i,
  },
];

function normalizeTaskType(taskType) {
  if (!taskType || typeof taskType !== "string") return "unknown";
  return taskType.trim().toLowerCase();
}

function userMessageFor(code) {
  switch (code) {
    case "sexual_explicit":
    case "violence_illegal":
      return "EnglishMind chỉ hỗ trợ học tiếng Anh. Nội dung này không phù hợp.";
    case "jailbreak":
    case "general_chatbox":
      return "EnglishMind không phải chatbox AI chung — hãy nhập nội dung liên quan học tiếng Anh.";
    default:
      return "Nội dung không phù hợp với mục tiêu học tiếng Anh.";
  }
}

function check({ taskType, prompt, systemInstruction }) {
  const task = normalizeTaskType(taskType);
  const promptText = typeof prompt === "string" ? prompt : "";
  const systemText = typeof systemInstruction === "string" ? systemInstruction : "";

  const promptMax = PROMPT_MAX_BY_TASK[task] ?? DEFAULT_PROMPT_MAX;
  if (promptText.length > promptMax) {
    return {
      ok: false,
      code: "prompt_too_long",
      error: "content_policy",
      errorMessage: `Nội dung quá dài (tối đa ${promptMax} ký tự). Hãy rút gọn và thử lại.`,
    };
  }

  if (systemText.length > SYSTEM_INSTRUCTION_MAX) {
    return {
      ok: false,
      code: "system_too_long",
      error: "content_policy",
      errorMessage: "Yêu cầu không hợp lệ. Vui lòng cập nhật app và thử lại.",
    };
  }

  const haystack = promptText;
  for (const { code, pattern } of BLOCK_PATTERNS) {
    if (pattern.test(haystack)) {
      return {
        ok: false,
        code,
        error: "content_policy",
        errorMessage: userMessageFor(code),
      };
    }
  }

  return { ok: true };
}

module.exports = {
  check,
  PROMPT_MAX_BY_TASK,
  DEFAULT_PROMPT_MAX,
  SYSTEM_INSTRUCTION_MAX,
  BLOCK_PATTERNS,
};

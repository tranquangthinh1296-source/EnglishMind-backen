const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSystemInstruction,
  hasTemplate,
  LEGACY_SYSTEM_INSTRUCTION_MAX,
  resolveSystemInstruction,
  validatePromptParams,
} = require("../src/services/systemInstructions");

describe("systemInstructions registry", () => {
  it("builds server instruction for templated task and ignores client strings by construction", () => {
    const built = buildSystemInstruction("conversation_turn", {
      cefrLevel: "A2",
      tone: "friendly",
      persona: "covy",
    });
    assert.equal(built.ok, true);
    assert.equal(built.found, true);
    assert.match(built.systemInstruction, /Ms\. Vy/);
    assert.match(built.systemInstruction, /Student CEFR A2/);
    assert.doesNotMatch(built.systemInstruction, /client override/i);
  });

  it("covers current high-cost server task keys without expanding quota allowlist", () => {
    for (const taskType of [
      "conversation_turn",
      "speak_english_teacher",
      "voice_analysis_short",
      "translate_core",
      "content_generation",
    ]) {
      assert.equal(hasTemplate(taskType), true, taskType);
      assert.equal(buildSystemInstruction(taskType, {}).found, true);
    }
    assert.equal(hasTemplate("teacher_response"), false);
    assert.equal(hasTemplate("utterance_analysis"), false);
    assert.equal(hasTemplate("translate_idea"), false);
  });

  it("covers web-lite task keys (PROMPT-GOV-WEB-1)", () => {
    for (const taskType of [
      "teacher_translate",
      "conversation_reply",
      "context_translate",
      "email_write",
      "email_rewrite",
      "reply_assistant",
      "scripted_dialogue",
    ]) {
      const built = buildSystemInstruction(taskType, {});
      assert.equal(built.found, true, taskType);
      assert.match(built.systemInstruction, /Bảo mật nội dung/, `${taskType} must include INPUT_IS_DATA`);
    }
    // word_lookup deliberately stays legacy until Android+web migrate together.
    assert.equal(hasTemplate("word_lookup"), false);
  });

  it("email_write template handles both directions and bilingual toggle from the user prompt", () => {
    const built = buildSystemInstruction("email_write", {});
    assert.match(built.systemInstruction, /Viết email tiếng Anh từ ý tiếng Việt/);
    assert.match(built.systemInstruction, /Dịch email tiếng Anh đã nhận sang tiếng Việt/);
    assert.match(built.systemInstruction, /Song ngữ: có/);
    assert.match(built.systemInstruction, /DATA INTEGRITY/);
  });

  it("reply_assistant returns 3 variants; scripted_dialogue mirrors CoVy facilitator persona", () => {
    const reply = buildSystemInstruction("reply_assistant", {});
    assert.match(reply.systemInstruction, /exactly 3 useful reply variants/);
    assert.match(reply.systemInstruction, /replies: exactly 3 items/);

    const scripted = buildSystemInstruction("scripted_dialogue", { cefrLevel: "A2" });
    assert.match(scripted.systemInstruction, /scripted speaking practice/);
    assert.match(scripted.systemInstruction, /FIXED linear scripted dialogue \(8-12 turns\)/);
    assert.match(scripted.systemInstruction, /Stay in character as Cô Vy/);
    assert.match(scripted.systemInstruction, /Student CEFR A2/);
  });

  it("conversation_reply writes the user's reply, not a roleplay counterpart", () => {
    const built = buildSystemInstruction("conversation_reply", { cefrLevel: "B1" });
    assert.match(built.systemInstruction, /do NOT role-play the other side/);
    assert.match(built.systemInstruction, /Student CEFR B1/);
    assert.doesNotMatch(built.systemInstruction, /end with an open question/);
  });

  it("leaves legacy task types available when REQUIRE_SERVER_SI is false", () => {
    const resolved = resolveSystemInstruction(
      {
        taskType: "word_lookup",
        systemInstruction: "x".repeat(LEGACY_SYSTEM_INSTRUCTION_MAX + 10),
      },
      { requireServerSi: false },
    );
    assert.equal(resolved.ok, true);
    assert.equal(resolved.legacy, true);
    assert.equal(resolved.systemInstruction.length, LEGACY_SYSTEM_INSTRUCTION_MAX);
  });

  it("rejects legacy task types when REQUIRE_SERVER_SI is true", () => {
    const resolved = resolveSystemInstruction(
      { taskType: "word_lookup", systemInstruction: "legacy" },
      { requireServerSi: true },
    );
    assert.equal(resolved.ok, false);
    assert.equal(resolved.error, "server_system_instruction_required");
  });

  it("rejects invalid prompt param enums", () => {
    assert.deepEqual(validatePromptParams({ cefrLevel: "Z9" }), {
      ok: false,
      error: "invalid_prompt_params",
      field: "cefrLevel",
    });
    assert.deepEqual(validatePromptParams({ tone: "pirate" }), {
      ok: false,
      error: "invalid_prompt_params",
      field: "tone",
    });
  });
});

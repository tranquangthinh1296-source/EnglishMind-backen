const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("../src/services/privacyClassifier");

function hasTypes(result, expected) {
  for (const t of expected) {
    assert.ok(result.detectedTypes.includes(t), `missing type ${t} in ${JSON.stringify(result)}`);
  }
}

function level(result, expected) {
  assert.equal(result.privacyLevel, expected);
}

describe("privacyClassifier", () => {
  const anchors = [
    {
      name: "anchor blocked phone contract money",
      text: "gửi anh Tuấn 0903123456 hợp đồng HD-2024/15 trị giá 2,5 tỷ",
      level: "blocked_sensitive",
      types: ["phone_vn", "contract_number", "money"],
    },
    {
      name: "anchor safe apology",
      text: "tôi muốn xin lỗi khách vì trễ deadline",
      level: "safe_to_template",
      types: [],
    },
    {
      name: "anchor private project",
      text: "dự án Sunrise City cần bản vẽ mới",
      level: "private",
      types: ["project_name"],
    },
    {
      name: "anchor safe quantity no false positive",
      text: "tầng 5 có 120 cột bê tông",
      level: "safe_to_template",
      types: [],
    },
    {
      name: "anchor blocked email",
      text: "email tôi là test@gmail.com",
      level: "blocked_sensitive",
      types: ["email"],
    },
    {
      name: "B4.1 safe quantity k suffix not money",
      text: "cần mua 100k viên gạch cho tầng 3",
      level: "safe_to_template",
      types: [],
    },
    {
      name: "B4.1 safe HD display size not contract",
      text: "HD 65 inch treo phòng họp",
      level: "safe_to_template",
      types: [],
    },
  ];

  for (const a of anchors) {
    it(a.name, () => {
      const r = classify(a.text);
      level(r, a.level);
      hasTypes(r, a.types);
      if (a.types.length === 0) assert.equal(r.detectedTypes.length, 0);
    });
  }

  const extras = [
    ["xin gửi báo giá 15 triệu VND", "blocked_sensitive", ["money"]],
    ["liên hệ +84901234567", "blocked_sensitive", ["phone_vn"]],
    ["contract #2024-99 signed", "blocked_sensitive", ["contract_number"]],
    ["Could you review the BOQ tomorrow?", "safe_to_template", []],
    ["Em cần làm rõ scope công việc", "safe_to_template", []],
    ["Please confirm the meeting time", "safe_to_template", []],
    ["project Alpha Tower needs revision", "private", ["project_name"]],
    ["số 12 đường Lê Lợi quận 1", "private", ["address"]],
    ["so 5 duong Nguyen Hue", "private", ["address"]],
    ["hợp đồng HD-88 ký tuần sau", "blocked_sensitive", ["contract_number"]],
    ["giá trị 3.2 ty dong", "blocked_sensitive", ["money"]],
    ["budget around 500 usd", "blocked_sensitive", ["money"]],
    ["gọi em qua 0912 345 678 nhé", "blocked_sensitive", ["phone_vn"]],
    ["my email is user.name@company.co.uk", "blocked_sensitive", ["email"]],
    ["khối lượng bê tông tầng 3 là 45 cột", "safe_to_template", []],
    ["deadline bàn giao tuần sau", "safe_to_template", []],
    ["I will send the drawing later", "safe_to_template", []],
    ["du an Green Park can cap nhat", "private", ["project_name"]],
    ["HD-2024/01 payment schedule", "blocked_sensitive", ["contract_number"]],
    ["chi phí 120tr cho hạng mục điện", "blocked_sensitive", ["money"]],
    ["xin lỗi vì phản hồi chậm", "safe_to_template", []],
    ["team cần họp coordination lúc 3pm", "safe_to_template", []],
    ["phố Wall street trong ví dụ học", "safe_to_template", []],
    ["long text private only", "private", ["long_sensitive_text"]],
    ["mixed safe construction terms only", "safe_to_template", []],
  ];

  for (const [text, expectedLevel, types] of extras) {
    it(`extra: ${text.slice(0, 40)}`, () => {
      const input = text === "long text private only" ? "x".repeat(601) : text;
      const r = classify(input);
      level(r, expectedLevel);
      hasTypes(r, types);
    });
  }
});

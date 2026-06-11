// Owner email for beta feedback — instant or digest (scale: use digest + Railway Cron).
const nodemailer = require("nodemailer");
const { classify } = require("./privacyClassifier");

function notifyTo() {
  return (process.env.FEEDBACK_NOTIFY_TO || "").trim();
}

function emailMode() {
  const mode = (process.env.FEEDBACK_EMAIL_MODE || "digest").trim().toLowerCase();
  if (mode === "instant" || mode === "digest" || mode === "off") return mode;
  return "digest";
}

function isSmtpConfigured() {
  const host = (process.env.SMTP_HOST || "").trim();
  const user = (process.env.SMTP_USER || "").trim();
  const pass = (process.env.SMTP_PASS || "").trim();
  return Boolean(host && user && pass && notifyTo());
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST.trim(),
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER.trim(),
      pass: process.env.SMTP_PASS.trim(),
    },
  });
}

function fromAddress() {
  return (process.env.SMTP_FROM || process.env.SMTP_USER || "EnglishMind Beta").trim();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function messageForEmail(message) {
  const { privacyLevel } = classify(message || "");
  if (privacyLevel === "blocked_sensitive") {
    return "[Email ẩn bớt — có thể chứa SĐT/email/số tiền. Xem bản đầy đủ trong Postgres beta_feedback.]";
  }
  return message || "";
}

function formatRowHtml(row) {
  const msg = escapeHtml(messageForEmail(row.message));
  const preview = msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
  return `<tr>
    <td style="padding:8px;border:1px solid #ddd;white-space:nowrap">${escapeHtml(row.created_at)}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(row.category)}</td>
    <td style="padding:8px;border:1px solid #ddd">${preview}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(row.device_model || "")}</td>
    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(row.app_version || "")}</td>
    <td style="padding:8px;border:1px solid #ddd;font-size:11px">${escapeHtml(row.contact || "")}</td>
  </tr>`;
}

async function sendMail({ subject, html, text }) {
  if (!isSmtpConfigured()) {
    console.warn("[feedbackNotify] SMTP not configured — skip email");
    return { sent: false, reason: "smtp_not_configured" };
  }
  const transport = createTransport();
  await transport.sendMail({
    from: fromAddress(),
    to: notifyTo(),
    subject,
    text,
    html,
  });
  return { sent: true };
}

/** Fire-and-forget: one email per feedback (FEEDBACK_EMAIL_MODE=instant). */
function notifyFeedbackInstant(row) {
  if (emailMode() !== "instant" || !isSmtpConfigured()) return;
  const subject = `[EnglishMind] Feedback ${row.category} — ${row.device_model || "device"}`;
  const body = messageForEmail(row.message);
  const text = [
    `Thời gian: ${row.created_at}`,
    `Loại: ${row.category}`,
    `App: ${row.app_version || "?"}`,
    `Máy: ${row.device_model || "?"}`,
    `Liên hệ: ${row.contact || "(không)"}`,
    `ID: ${row.id}`,
    "",
    body,
  ].join("\n");
  const html = `<pre style="font-family:sans-serif;font-size:14px">${escapeHtml(text)}</pre>`;
  sendMail({ subject, html, text }).catch((err) => {
    console.error("[feedbackNotify] instant email failed:", err.message);
  });
}

/** Digest: all feedback in the last N hours — one email (recommended for many users). */
async function sendFeedbackDigest(pool, hours = null) {
  if (!isSmtpConfigured()) {
    return { sent: false, reason: "smtp_not_configured" };
  }
  const windowHours = Number(hours || process.env.FEEDBACK_DIGEST_HOURS || 24);
  const { rows } = await pool.query(
    `SELECT id, created_at, category, message, contact, device_model, app_version, device_hash
     FROM beta_feedback
     WHERE created_at >= NOW() - ($1::text || ' hours')::interval
     ORDER BY created_at DESC
     LIMIT 200`,
    [String(windowHours)]
  );
  if (rows.length === 0) {
    return { sent: false, reason: "no_rows", count: 0 };
  }
  const subject = `[EnglishMind] Báo cáo feedback ${rows.length} mục (${windowHours}h)`;
  const tableHead = `<table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px">
    <thead><tr style="background:#f4f4f4">
      <th style="padding:8px;border:1px solid #ddd">Thời gian</th>
      <th style="padding:8px;border:1px solid #ddd">Loại</th>
      <th style="padding:8px;border:1px solid #ddd">Nội dung</th>
      <th style="padding:8px;border:1px solid #ddd">Máy</th>
      <th style="padding:8px;border:1px solid #ddd">App</th>
      <th style="padding:8px;border:1px solid #ddd">Liên hệ</th>
    </tr></thead><tbody>`;
  const tableBody = rows.map(formatRowHtml).join("");
  const html = `${tableHead}${tableBody}</tbody></table>
    <p style="font-family:sans-serif;font-size:12px;color:#666">Tối đa 200 mục mới nhất trong ${windowHours}h. Cấu hình Railway Cron gọi POST /v1/admin/feedback-digest hàng ngày.</p>`;
  const text = rows
    .map(
      (r) =>
        `[${r.created_at}] ${r.category} | ${r.device_model} | ${messageForEmail(r.message).slice(0, 120)}`
    )
    .join("\n");
  await sendMail({ subject, html, text });
  return { sent: true, count: rows.length, windowHours };
}

module.exports = {
  emailMode,
  isSmtpConfigured,
  notifyFeedbackInstant,
  sendFeedbackDigest,
};

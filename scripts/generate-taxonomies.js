#!/usr/bin/env node
/**
 * Generates docs/intent-taxonomy-v1.json (C2) and docs/mistake-taxonomy-v1.json (C3).
 * Run: node server/scripts/generate-taxonomies.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const docs = path.join(root, 'docs');

function intent(id, vi_desc, domain, tone_default, vi_template, en_template) {
  return { id, vi_desc, domain, tone_default, vi_template, en_template };
}

const requiredIds = [
  'ask_for_clarification',
  'send_document_later',
  'request_review',
  'explain_delay',
  'follow_up_quotation',
  'confirm_meeting',
  'apologize_late_reply',
  'report_site_issue',
  'request_payment_document',
  'drawing_revision_notice',
  'quantity_confirmation',
];

const intents = [
  intent('ask_for_clarification', 'Hỏi làm rõ thông tin còn mơ hồ', 'office', 'professional',
    'Anh/chị có thể giải thích rõ hơn về {chủ_đề} được không?',
    'Could you please clarify {topic} so we are aligned?'),
  intent('send_document_later', 'Hứa gửi tài liệu sau', 'office', 'professional',
    'Em sẽ gửi {tài_liệu} cho anh/chị trước {thời_hạn}.',
    'I will send {document} to you by {deadline}.'),
  intent('request_review', 'Đề nghị xem xét / duyệt', 'qs', 'professional',
    'Nhờ anh/chị xem xét {tài_liệu} và phản hồi giúp em.',
    'Could you please review {document} and share your feedback?'),
  intent('explain_delay', 'Giải thích trễ hạn', 'construction', 'professional',
    'Em xin phép báo trễ {hạng_mục} do {lý_do}.',
    'I would like to inform you that {item} will be delayed due to {reason}.'),
  intent('follow_up_quotation', 'Nhắc lại báo giá', 'qs', 'professional',
    'Em xin phép nhắc lại báo giá {hạng_mục} đã gửi ngày {ngày}.',
    'I am following up on the quotation for {item} sent on {date}.'),
  intent('confirm_meeting', 'Xác nhận lịch họp', 'office', 'professional',
    'Em xác nhận cuộc họp {chủ_đề} lúc {giờ} ngày {ngày}.',
    'I confirm our meeting on {topic} at {time} on {date}.'),
  intent('apologize_late_reply', 'Xin lỗi vì trả lời chậm', 'office', 'friendly',
    'Em xin lỗi vì phản hồi chậm về {chủ_đề}.',
    'I apologize for the delayed reply regarding {topic}.'),
  intent('report_site_issue', 'Báo sự cố công trường', 'construction', 'professional',
    'Em báo cáo sự cố {vấn_đề} tại {vị_trí} cần xử lý gấp.',
    'I would like to report an issue with {issue} at {location} that needs urgent attention.'),
  intent('request_payment_document', 'Yêu cầu chứng từ thanh toán', 'office', 'professional',
    'Nhờ anh/chị gửi giúp em {chứng_từ} cho đợt thanh toán {đợt}.',
    'Could you please provide {document} for payment phase {phase}?'),
  intent('drawing_revision_notice', 'Thông báo chỉnh sửa bản vẽ', 'construction', 'professional',
    'Em gửi bản vẽ {mã_bản_vẽ} đã chỉnh sửa theo yêu cầu {phiên_bản}.',
    'Please find the revised drawing {drawing_id} per revision {revision}.'),
  intent('quantity_confirmation', 'Xác nhận khối lượng', 'qs', 'professional',
    'Nhờ anh/chị xác nhận khối lượng {hạng_mục} trong {tài_liệu}.',
    'Could you please confirm the quantities for {item} in {document}?'),
  // QS / construction (extra)
  intent('request_boq_revision', 'Đề nghị chỉnh BOQ', 'qs', 'professional',
    'BOQ {mã} cần cập nhật theo {phiên_bản} mới nhất.',
    'The BOQ {code} needs to be updated per the latest {revision}.'),
  intent('confirm_material_spec', 'Xác nhận quy cách vật tư', 'construction', 'professional',
    'Nhờ xác nhận quy cách {vật_tư} theo bản vẽ {mã}.',
    'Please confirm the specification for {material} per drawing {code}.'),
  intent('schedule_site_inspection', 'Hẹn kiểm tra hiện trường', 'construction', 'professional',
    'Em đề xuất kiểm tra hiện trường {khu_vực} vào {ngày_giờ}.',
    'I suggest a site inspection of {area} on {datetime}.'),
  intent('request_as_built_drawing', 'Yêu cầu bản vẽ hoàn công', 'construction', 'professional',
    'Nhờ cung cấp bản vẽ as-built cho {hạng_mục}.',
    'Could you provide the as-built drawing for {item}?'),
  intent('notify_concrete_pour_delay', 'Báo trễ đổ bê tông', 'construction', 'professional',
    'Lịch đổ bê tông {vị_trí} bị dời sang {ngày_mới}.',
    'The concrete pour at {location} has been rescheduled to {new_date}.'),
  intent('request_shop_drawing_approval', 'Xin duyệt shop drawing', 'construction', 'professional',
    'Em gửi shop drawing {mã} để anh/chị phê duyệt.',
    'Please find shop drawing {code} for your approval.'),
  intent('confirm_warranty_period', 'Xác nhận thời hạn bảo hành', 'construction', 'professional',
    'Nhờ xác nhận thời hạn bảo hành {hạng_mục} là {thời_gian}.',
    'Please confirm the warranty period for {item} is {duration}.'),
  intent('request_rfi_response', 'Yêu cầu trả lời RFI', 'qs', 'professional',
    'RFI số {số} về {chủ_đề} cần phản hồi trước {hạn}.',
    'RFI {number} regarding {topic} requires a response by {deadline}.'),
  intent('notify_design_change', 'Thông báo thay đổi thiết kế', 'construction', 'professional',
    'Có thay đổi thiết kế {mô_tả} ảnh hưởng {hạng_mục}.',
    'There is a design change: {description}, affecting {item}.'),
  // Interior
  intent('request_material_sample', 'Yêu cầu mẫu vật liệu', 'interior', 'professional',
    'Nhờ gửi mẫu {vật_liệu} cho phương án {phòng}.',
    'Could you send material samples for {material} for the {room} option?'),
  intent('confirm_finish_schedule', 'Xác nhận tiến độ hoàn thiện', 'interior', 'professional',
    'Tiến độ hoàn thiện {khu_vực} dự kiến xong {ngày}.',
    'The finishing work in {area} is expected to complete by {date}.'),
  intent('revise_furniture_layout', 'Điều chỉnh bố trí nội thất', 'interior', 'professional',
    'Em đề xuất chỉnh layout {phòng} theo phản hồi {người_nhận}.',
    'I propose revising the {room} layout based on {recipient} feedback.'),
  intent('request_lighting_plan', 'Yêu cầu bản vẽ chiếu sáng', 'interior', 'professional',
    'Nhờ cập nhật lighting plan cho {khu_vực}.',
    'Please update the lighting plan for {area}.'),
  intent('approve_color_palette', 'Phê duyệt bảng màu', 'interior', 'friendly',
    'Anh/chị duyệt giúp em bảng màu {phương_án} cho {không_gian}.',
    'Could you approve color palette {option} for {space}?'),
  intent('request_moodboard_review', 'Gửi moodboard để duyệt', 'interior', 'friendly',
    'Em gửi moodboard {tên} cho {dự_án}.',
    'Please find moodboard {name} for {project}.'),
  // Office (≥20)
  intent('request_leave_approval', 'Xin nghỉ phép', 'office', 'professional',
    'Em xin nghỉ {ngày} vì {lý_do}.',
    'I would like to request leave on {date} due to {reason}.'),
  intent('delegate_task', 'Giao việc cho đồng nghiệp', 'office', 'professional',
    'Nhờ {người_nhận} hỗ trợ {công_việc} trước {hạn}.',
    'Could {assignee} please handle {task} by {deadline}?'),
  intent('set_deadline_reminder', 'Nhắc deadline', 'office', 'professional',
    'Nhắc anh/chị deadline {công_việc} là {ngày}.',
    'This is a reminder that {task} is due on {date}.'),
  intent('request_budget_approval', 'Xin duyệt ngân sách', 'office', 'professional',
    'Em trình ngân sách {hạng_mục} khoảng {số_tiền}.',
    'I am submitting a budget request for {item} of approximately {amount}.'),
  intent('introduce_new_team_member', 'Giới thiệu thành viên mới', 'office', 'friendly',
    'Em xin giới thiệu {tên} — {vai_trò} trong team {bộ_phận}.',
    'I would like to introduce {name}, our new {role} in {department}.'),
  intent('reschedule_call', 'Dời cuộc gọi', 'office', 'professional',
    'Em xin dời cuộc gọi {chủ_đề} sang {thời_gian_mới}.',
    'May I reschedule our call on {topic} to {new_time}?'),
  intent('share_meeting_minutes', 'Gửi biên bản họp', 'office', 'professional',
    'Em gửi biên bản cuộc họp {chủ_đề} ngày {ngày}.',
    'Please find the minutes from our {topic} meeting on {date}.'),
  intent('request_status_update', 'Hỏi tiến độ', 'office', 'professional',
    'Anh/chị cập nhật giúp em tiến độ {công_việc} được không?',
    'Could you share a status update on {task}?'),
  intent('escalate_issue_to_manager', 'Escalate vấn đề lên quản lý', 'office', 'professional',
    'Em cần escalate vấn đề {vấn_đề} lên {quản_lý}.',
    'I need to escalate {issue} to {manager}.'),
  intent('thank_for_cooperation', 'Cảm ơn hợp tác', 'office', 'friendly',
    'Em cảm ơn anh/chị đã hỗ trợ {công_việc}.',
    'Thank you for your support with {task}.'),
  intent('negotiate_timeline', 'Thương lượng tiến độ', 'office', 'professional',
    'Em đề xuất điều chỉnh timeline {dự_án} sang {mốc_mới}.',
    'I propose adjusting the {project} timeline to {new_milestone}.'),
  intent('request_signature', 'Xin ký duyệt', 'office', 'professional',
    'Nhờ anh/chị ký {tài_liệu} giúp em.',
    'Could you please sign {document}?'),
  intent('acknowledge_receipt', 'Xác nhận đã nhận', 'office', 'professional',
    'Em xác nhận đã nhận {tài_liệu}.',
    'I confirm receipt of {document}.'),
  intent('propose_alternative_solution', 'Đề xuất phương án thay thế', 'office', 'professional',
    'Em đề xuất phương án thay thế: {phương_án}.',
    'I would like to propose an alternative: {solution}.'),
  intent('request_feedback_on_draft', 'Xin góp ý bản nháp', 'office', 'professional',
    'Nhờ anh/chị góp ý bản nháp {tài_liệu}.',
    'Could you review the draft {document} and share your comments?'),
  intent('confirm_delivery_date', 'Xác nhận ngày giao hàng', 'office', 'professional',
    'Xác nhận giao {hàng_hóa} ngày {ngày}.',
    'Please confirm delivery of {goods} on {date}.'),
  intent('request_vendor_quote', 'Xin báo giá nhà cung cấp', 'office', 'professional',
    'Nhờ báo giá {hạng_mục} cho {dự_án}.',
    'Could you provide a quotation for {item} for {project}?'),
  intent('notify_policy_change', 'Thông báo thay đổi quy định', 'office', 'professional',
    'Có cập nhật quy định {tên_quy_định} từ {ngày}.',
    'Please note an update to {policy} effective {date}.'),
  intent('request_training_session', 'Đề xuất buổi training', 'office', 'friendly',
    'Em đề xuất buổi training về {chủ_đề} vào {thời_gian}.',
    'I suggest a training session on {topic} at {time}.'),
  intent('submit_weekly_report', 'Nộp báo cáo tuần', 'office', 'professional',
    'Em gửi báo cáo tuần {tuần} cho {bộ_phận}.',
    'Please find my weekly report for week {week} for {department}.'),
  intent('request_access_permission', 'Xin quyền truy cập', 'office', 'professional',
    'Em xin quyền truy cập {hệ_thống} cho {mục_đích}.',
    'I would like to request access to {system} for {purpose}.'),
  intent('welcome_new_client', 'Chào khách hàng mới', 'office', 'friendly',
    'Chào mừng {tên_khách} đến với {công_ty}.',
    'Welcome to {company}, {client_name}.'),
  intent('request_invoice_correction', 'Yêu cầu sửa hóa đơn', 'office', 'professional',
    'Hóa đơn {số} cần chỉnh {nội_dung}.',
    'Invoice {number} needs a correction to {detail}.'),
  // General / daily
  intent('greet_colleague', 'Chào đồng nghiệp', 'general', 'friendly',
    'Chào {tên}, hôm nay {anh/chị} thế nào?',
    'Hi {name}, how are you today?'),
  intent('small_talk_weather', 'Trò chuyện thời tiết', 'general', 'casual',
    'Hôm nay trời {mô_tả}, {anh/chị} đi làm ổn không?',
    'The weather is {description} today — did you get to work okay?'),
  intent('order_lunch_together', 'Rủ ăn trưa', 'general', 'casual',
    'Trưa nay {anh/chị} ăn {món} cùng team không?',
    'Would you like to join us for {dish} at lunch?'),
  intent('ask_directions_site', 'Hỏi đường đến công trường', 'general', 'neutral',
    'Cho em hỏi đường đến {địa_điểm} từ {vị_trí}.',
    'Could you tell me how to get to {place} from {location}?'),
  intent('request_help_translation', 'Nhờ dịch nhanh', 'general', 'friendly',
    'Anh/chị dịch giúp em câu này: {câu_tiếng_Việt}.',
    'Could you help me translate this: {vietnamese_sentence}?'),
  intent('express_agreement', 'Đồng ý lịch sự', 'general', 'neutral',
    'Em đồng ý với {ý_kiến}.',
    'I agree with {point}.'),
  intent('express_disagreement_politely', 'Phản đối lịch sự', 'general', 'professional',
    'Em hiểu ý anh/chị, nhưng em nghĩ {quan_điểm_khác} phù hợp hơn.',
    'I understand your point, but I think {alternative} might work better.'),
  intent('end_conversation_politely', 'Kết thúc hội thoại', 'general', 'friendly',
    'Em cảm ơn anh/chị, hẹn {thời_gian} nhé.',
    'Thank you — talk to you {time}.'),
  intent('ask_for_recommendation', 'Xin gợi ý', 'general', 'friendly',
    'Anh/chị gợi ý giúp em {chủ_đề} được không?',
    'Could you recommend something for {topic}?'),
  intent('share_good_news', 'Chia sẻ tin vui', 'general', 'friendly',
    'Em có tin vui: {tin}.',
    'I have good news: {news}.'),
  intent('offer_assistance', 'Đề nghị hỗ trợ', 'general', 'friendly',
    'Em có thể hỗ trợ anh/chị {việc} không?',
    'Can I help you with {task}?'),
  intent('request_time_off_general', 'Xin nghỉ (chung)', 'general', 'professional',
    'Em xin nghỉ {buổi} ngày {ngày}.',
    'I would like to take {session} off on {date}.'),
];

const intentDoc = { version: 1, intents };
const ids = new Set(intents.map((i) => i.id));
for (const rid of requiredIds) {
  if (!ids.has(rid)) throw new Error(`Missing required intent: ${rid}`);
}
const domains = { construction: 0, qs: 0, interior: 0, office: 0, general: 0 };
for (const i of intents) {
  domains[i.domain] = (domains[i.domain] || 0) + 1;
}
const qsConstruction = domains.construction + domains.qs;
if (intents.length < 50) throw new Error(`Need ≥50 intents, got ${intents.length}`);
if (qsConstruction < 15) throw new Error(`Need ≥15 qs+construction, got ${qsConstruction}`);
if (domains.interior < 5) throw new Error(`Need ≥5 interior, got ${domains.interior}`);
if (domains.office < 20) throw new Error(`Need ≥20 office, got ${domains.office}`);
if (domains.general < 10) throw new Error(`Need ≥10 general, got ${domains.general}`);

fs.writeFileSync(path.join(docs, 'intent-taxonomy-v1.json'), JSON.stringify(intentDoc, null, 2) + '\n');

const mistakes = [
  {
    id: 'word_by_word_translation',
    vi_desc: 'Dịch từng chữ theo trật tự tiếng Việt',
    coaching_template_vi: 'Bạn đang dịch từng chữ: {wrong} → hãy dùng: {right}. {why_vi}',
    examples: [
      { wrong: 'I very like this drawing', right: 'I really like this drawing', why_vi: "'rất thích' không dịch là 'very like' — very không đứng trước động từ thường." },
      { wrong: 'Please check again the quantity', right: 'Please check the quantity again', why_vi: 'Trạng từ "again" thường đứng cuối, không chen giữa verb và object.' },
      { wrong: 'I want you review this BOQ', right: 'I would like you to review this BOQ', why_vi: "Sau 'want you' cần 'to' + V hoặc dùng 'would like' lịch sự hơn." },
    ],
  },
  {
    id: 'missing_article',
    vi_desc: 'Thiếu mạo từ a/an/the',
    coaching_template_vi: 'Thiếu mạo từ: {wrong} → {right}. {why_vi}',
    examples: [
      { wrong: 'Please send me drawing', right: 'Please send me the drawing', why_vi: 'Bản vẽ cụ thể đã nhắc tới → dùng "the".' },
      { wrong: 'We need update for schedule', right: 'We need an update on the schedule', why_vi: 'Update đếm được → "an update"; "on" phù hợp hơn "for" với schedule.' },
      { wrong: 'He is site engineer', right: 'He is a site engineer', why_vi: 'Nghề nghiệp đếm được → cần "a".' },
    ],
  },
  {
    id: 'wrong_tense',
    vi_desc: 'Sai thì (quá khứ/hiện tại/tương lai)',
    coaching_template_vi: 'Sai thì: {wrong} → {right}. {why_vi}',
    examples: [
      { wrong: 'We finish the slab yesterday', right: 'We finished the slab yesterday', why_vi: 'Có "yesterday" → quá khứ đơn.' },
      { wrong: 'I will sent the file tomorrow', right: 'I will send the file tomorrow', why_vi: 'Sau "will" dùng động từ nguyên mẫu, không chia quá khứ.' },
      { wrong: 'The client approve the design last week', right: 'The client approved the design last week', why_vi: 'Chủ ngữ số ít quá khứ → động từ thêm -ed.' },
    ],
  },
  {
    id: 'too_direct_tone',
    vi_desc: 'Giọng quá thẳng, thiếu lịch sự',
    coaching_template_vi: 'Câu hơi trực tiếp: {wrong} → {right}. {why_vi}',
    examples: [
      { wrong: 'Send me the BOQ now', right: 'Could you please send me the BOQ when you have a moment?', why_vi: 'Email công việc nên dùng modal + please.' },
      { wrong: 'You must fix this drawing', right: 'Could you please revise this drawing?', why_vi: "'must' nghe ra mệnh lệnh — dùng request lịch sự." },
      { wrong: 'I want meeting at 3pm', right: 'Would it be possible to meet at 3 p.m.?', why_vi: "'I want' quá cá nhân — đề xuất lịch nên hỏi khả năng." },
    ],
  },
  {
    id: 'missing_subject',
    vi_desc: 'Thiếu chủ ngữ (kiểu tiếng Việt)',
    coaching_template_vi: 'Thiếu chủ ngữ: {wrong} → {right}. {why_vi}',
    examples: [
      { wrong: 'Will send the revised drawing today', right: 'I will send the revised drawing today', why_vi: 'Tiếng Anh cần chủ ngữ rõ (thường là I/We).' },
      { wrong: 'Is delayed due to rain', right: 'The pour is delayed due to rain', why_vi: 'Câu độc lập cần subject — ở đây là hạng mục bị trễ.' },
      { wrong: 'Confirmed the quantities', right: 'We have confirmed the quantities', why_vi: 'Động từ chia thì cần subject — thêm We/I.' },
    ],
  },
  {
    id: 'long_sentence',
    vi_desc: 'Câu quá dài, khó theo dõi',
    coaching_template_vi: 'Câu dài khó đọc: {wrong} → tách thành: {right}. {why_vi}',
    examples: [
      { wrong: 'I am writing to inform you that because of the weather and the supplier delay and the site access issue we will need to postpone the concrete pour which was scheduled for Friday to next Monday morning', right: 'We need to postpone Friday\'s concrete pour to Monday morning. This is due to weather, a supplier delay, and limited site access.', why_vi: 'Tách 2 câu: thông báo chính + lý do.' },
      { wrong: 'Regarding the BOQ that you sent last week and the comments from the client and our internal review we found several items that need clarification', right: 'Regarding last week\'s BOQ, our internal review and the client\'s comments raised several items that need clarification.', why_vi: 'Gom cụm danh từ, tránh nối quá nhiều mệnh đề.' },
      { wrong: 'Please review and approve and sign and return the document', right: 'Please review, approve, and sign the document, then return it.', why_vi: 'Liệt kê hành động bằng dấu phẩy + then cho bước cuối.' },
    ],
  },
  {
    id: 'wrong_preposition',
    vi_desc: 'Sai giới từ',
    coaching_template_vi: 'Sai giới từ: {wrong} → {right}. {why_vi}',
    examples: [
      { wrong: 'We agree with your proposal', right: 'We agree to your proposal', why_vi: 'Agree to a proposal/plan; agree with a person/opinion.' },
      { wrong: 'Please discuss about the schedule', right: 'Please discuss the schedule', why_vi: 'Discuss là ngoại động từ — không cần "about".' },
      { wrong: 'The meeting is in Monday', right: 'The meeting is on Monday', why_vi: 'Ngày trong tuần dùng "on".' },
    ],
  },
  {
    id: 'unnatural_collocation',
    vi_desc: 'Cụm từ không tự nhiên (collocation sai)',
    coaching_template_vi: 'Cụm không tự nhiên: {wrong} → {right}. {why_vi}',
    examples: [
      { wrong: 'Make a check of the quantities', right: 'Check the quantities', why_vi: 'Người bản ngữ thường dùng verb trực tiếp, không "make a check of".' },
      { wrong: 'Open the light in the meeting room', right: 'Turn on the lights in the meeting room', why_vi: 'Đèn dùng turn on/off, không open.' },
      { wrong: 'Strong rain caused delay', right: 'Heavy rain caused the delay', why_vi: 'Mưa lớn = heavy rain; strong dùng cho gió/sự kiện khác.' },
    ],
  },
];

const mistakeDoc = { version: 1, mistakes };
if (mistakes.length !== 8) throw new Error('Need exactly 8 mistake groups');
for (const m of mistakes) {
  if (m.examples.length !== 3) throw new Error(`${m.id} needs 3 examples`);
}

fs.writeFileSync(path.join(docs, 'mistake-taxonomy-v1.json'), JSON.stringify(mistakeDoc, null, 2) + '\n');

console.log('C2:', intents.length, 'intents', domains);
console.log('C3:', mistakes.length, 'mistake groups');
console.log('Wrote', path.join(docs, 'intent-taxonomy-v1.json'));
console.log('Wrote', path.join(docs, 'mistake-taxonomy-v1.json'));

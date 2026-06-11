# 🚀 Hướng dẫn deploy backend (cho người không rành kỹ thuật)

> Mục tiêu: đưa thư mục `server/` lên mạng (Railway) để app gọi AI an toàn.
> Bạn KHÔNG cần biết code. Chỉ cần làm theo từng bước, copy–paste.
> Làm xong hết khoảng **45–60 phút**. Cứ từ từ, không vội.

Có **5 phần**, làm lần lượt:
- Phần A: Lấy "chìa khóa" Gemini (API key)
- Phần B: Lấy "thẻ nhân viên" Firebase (service account)
- Phần C: Đưa server lên Railway
- Phần D: Khai báo các thông số (biến môi trường)
- Phần E: Cấu hình Firebase + chỉ cho app dùng server mới

> 💡 Mẹo: mở file này ở một bên màn hình, trình duyệt ở bên kia để vừa đọc vừa làm.
> Mỗi khi lấy được một mã/chuỗi quan trọng, **dán tạm vào Notepad** rồi đặt tên cho nó, để Phần D dùng lại.

---

## ✅ PHẦN A — Lấy chìa khóa Gemini (API key)

Đây là mã để server gọi AI của Google.

1. Mở trình duyệt, vào: **https://aistudio.google.com/app/apikey**
2. Đăng nhập bằng tài khoản Google của bạn.
3. Bấm nút **"Create API key"** (Tạo khóa API).
4. Nó hiện ra một chuỗi dài kiểu `AIzaSy...`. Bấm **Copy**.
5. Mở **Notepad**, dán vào, ghi chú phía trước: `GEMINI_API_KEY = AIzaSy...`

> ✅ Xong Phần A. Bạn đã có 1 chuỗi.

---

## ✅ PHẦN B — Lấy thẻ nhân viên Firebase (service account)

Đây là tệp cho phép server kiểm tra người dùng đăng nhập.

1. Vào: **https://console.firebase.google.com/**
2. Bấm chọn **dự án EnglishMind** của bạn.
3. Góc trên bên trái, bấm **biểu tượng bánh răng ⚙️** → chọn **Project settings** (Cài đặt dự án).
4. Bấm tab **"Service accounts"** (Tài khoản dịch vụ).
5. Bấm nút **"Generate new private key"** (Tạo khóa riêng tư mới) → hiện cảnh báo → bấm **"Generate key"**.
6. Trình duyệt sẽ **tải về một tệp `.json`** (ví dụ `englishmind-xxxx.json`). Tệp này rất quan trọng, **giữ bí mật, không gửi cho ai**.
7. Mở tệp `.json` đó bằng **Notepad**:
   - Chuột phải vào tệp → **Open with** → **Notepad**.
   - Bạn sẽ thấy nội dung kiểu `{"type":"service_account","project_id":"...", ...}`.
8. Bấm **Ctrl+A** (chọn hết) → **Ctrl+C** (copy) → dán vào Notepad của bạn, ghi chú: `FIREBASE_SERVICE_ACCOUNT = {...toàn bộ nội dung...}`

> ⚠️ Lưu ý: phải copy **TOÀN BỘ** nội dung tệp, từ dấu `{` đầu tiên đến dấu `}` cuối cùng.
> ✅ Xong Phần B. Bạn đã có nội dung tệp json.

---

## ✅ PHẦN C — Đưa server lên Railway

Railway là dịch vụ "máy chủ thuê" miễn phí/giá rẻ để chạy server.

### C1. Tạo tài khoản Railway
1. Vào: **https://railway.app/**
2. Bấm **"Login"** → chọn **"Login with GitHub"** (nên dùng GitHub vì code đang ở đó).
3. Đồng ý cấp quyền.

### C2. Tạo project mới từ GitHub
1. Sau khi đăng nhập, bấm **"New Project"**.
2. Chọn **"Deploy from GitHub repo"**.
3. Nếu lần đầu, Railway xin quyền xem GitHub → bấm **"Configure GitHub App"** → chọn repo **EnglishMind** → **Save**.
4. Quay lại Railway, chọn đúng repo **EnglishMind** trong danh sách.

### C3. ⚠️ QUAN TRỌNG: chỉ định thư mục `server`
Vì repo có cả app Android lẫn server, phải nói cho Railway biết chạy thư mục `server`:
1. Sau khi chọn repo, Railway tạo 1 "service". Bấm vào service đó.
2. Vào tab **"Settings"**.
3. Tìm mục **"Root Directory"** (Thư mục gốc) → bấm sửa → gõ: `server` → lưu.
4. Tìm mục **"Start Command"** (Lệnh khởi động). Nếu trống, gõ: `npm start` → lưu.

> Lúc này Railway có thể báo deploy lỗi vì **chưa có biến môi trường** — bình thường, ta làm tiếp Phần D.

---

## ✅ PHẦN D — Khai báo các thông số (Variables)

Đây là lúc dùng những thứ đã lưu trong Notepad ở Phần A và B.

1. Vẫn trong service trên Railway, bấm tab **"Variables"** (Biến).
2. Bấm **"New Variable"** rồi thêm **lần lượt từng dòng** dưới đây.
   Mỗi biến gồm: **tên** (cột trái) và **giá trị** (cột phải).

| Tên biến (Name) | Giá trị (Value) |
|---|---|
| `GEMINI_API_KEY` | Dán chuỗi `AIzaSy...` (từ Phần A) |
| `GEMINI_MODEL` | `gemini-2.0-flash` |
| `FIREBASE_SERVICE_ACCOUNT` | Dán **toàn bộ nội dung json** (từ Phần B) |
| `PRO_PROXY_DAILY_LIMIT` | `1000` |
| `QUOTA_TIMEZONE` | `Asia/Ho_Chi_Minh` |
| `CONTENT_UPSTREAM_URL` | `https://englishmind-content.up.railway.app` |
| `TRIAL_SIGNING_SECRET` | Tự gõ một chuỗi bí mật bất kỳ, ví dụ `emind-secret-2026-xyz` |

3. Sau khi thêm đủ 7 biến, Railway sẽ **tự deploy lại**. Đợi 1–2 phút.
4. Khi thấy chữ **"Success"** hoặc đèn xanh là server đã chạy.

### D1. Lấy địa chỉ server (URL)
1. Vào tab **"Settings"** → mục **"Networking"** / **"Domains"**.
2. Bấm **"Generate Domain"** (Tạo tên miền).
3. Railway cho bạn một địa chỉ kiểu `https://englishmind-server-production.up.railway.app`.
4. **Copy địa chỉ này**, lưu vào Notepad, ghi: `URL SERVER MỚI = https://...`

### D2. Kiểm tra server sống chưa
1. Mở tab trình duyệt mới, dán địa chỉ vừa lấy và **thêm `/healthz`** vào cuối, ví dụ:
   `https://englishmind-server-production.up.railway.app/healthz`
2. Nếu màn hình hiện `{"ok":true}` → 🎉 **server đã chạy thành công!**
3. Nếu lỗi → xem Phần "Gặp lỗi?" ở cuối.

---

## ✅ PHẦN E — Cấu hình Firebase + chỉ app dùng server mới

### E1. Chỉ cho app dùng địa chỉ server mới
Có 2 cách, chọn **một**:

**Cách 1 (dễ, không cần build lại app):** dùng màn hình Settings trong app.
1. Mở app EnglishMind trên điện thoại.
2. Vào **Cài đặt (Settings)**.
3. Tìm ô **"Content Server URL"** (hoặc địa chỉ máy chủ).
4. Xóa địa chỉ cũ, dán **URL SERVER MỚI** (từ bước D1). Lưu lại.

**Cách 2 (cố định trong app, cần build lại):** nhờ lập trình viên sửa giá trị mặc định trong `DataStoreManager.kt` rồi build APK mới. (Để sau cũng được.)

### E2. Đánh dấu ai là người dùng Pro (entitlement)
Server chỉ cho gọi AI nếu người dùng là **admin** hoặc có **gói Pro**. Để test, ta tự đánh dấu tài khoản của bạn là Pro:

1. Vào **Firebase Console** → dự án EnglishMind → menu trái chọn **"Firestore Database"**.
2. Bấm **"Start collection"** (nếu chưa có) hoặc **"+ Add document"**.
3. Tạo theo cấu trúc sau (làm đúng từng tên):
   - Collection tên: `users`
   - Document ID: **UID của bạn** (lấy ở bước E3 bên dưới)
   - Trong document đó, tạo tiếp 1 sub-collection tên: `tier`
   - Trong `tier`, tạo 1 document ID: `current`
   - Trong `current`, thêm 1 field: tên `tier`, kiểu **string**, giá trị `PRO`

> Đường dẫn cuối cùng phải là: `users/{UID}/tier/current` với field `tier = "PRO"`.

### E3. Lấy UID của bạn
1. Firebase Console → menu trái **"Authentication"** → tab **"Users"**.
2. Tìm email của bạn (`tranquangthinh1296@gmail.com`).
3. Cột **"User UID"** là một chuỗi dài — **copy** nó, dùng làm Document ID ở bước E2.

> 💡 Hoặc nếu bạn đã được set **admin = true** (custom claim) thì không cần bước E2 — server tự cho phép.

### E4. (Khuyến nghị, làm sau cũng được) Chặn người dùng tự sửa quota
Để không ai gian lận, vào **Firestore → tab "Rules"**, đảm bảo có 2 dòng cấm ghi:
```
match /aiQuota/{uid} { allow read, write: if false; }
match /users/{uid}/tier/{doc} { allow read: if request.auth.uid == uid; allow write: if false; }
```
Bấm **"Publish"** để lưu.

---

## 🎉 KIỂM TRA CUỐI CÙNG

1. Mở app, đăng nhập đúng tài khoản đã đánh dấu Pro.
2. Dùng một tính năng AI (ví dụ Dịch ý tưởng).
3. Nếu AI trả kết quả bình thường → **mọi thứ đã hoạt động!**
4. Thử đổi giờ điện thoại qua nửa đêm → hạn mức AI **không** reset sớm (vì giờ tính ở server) → đúng như mong muốn.

---

## ❓ GẶP LỖI? (xử lý nhanh)

| Hiện tượng | Cách xử lý |
|---|---|
| `/healthz` không ra `{"ok":true}` | Vào Railway → tab **"Deployments"** → bấm log xem dòng đỏ. Thường do dán thiếu/sai `FIREBASE_SERVICE_ACCOUNT`. Dán lại toàn bộ json. |
| App báo lỗi AI / không phản hồi | Kiểm tra đã nhập đúng **URL SERVER MỚI** trong Settings chưa (E1); thử lại `/healthz`. |
| AI báo hết lượt dù chưa dùng | Kiểm tra `PRO_PROXY_DAILY_LIMIT` (nên là `1000`). |
| AI không chạy với tài khoản của bạn | Kiểm tra đã tạo đúng `users/{UID}/tier/current` với `tier="PRO"` (E2) chưa. |
| Deploy đỏ (Failed) trên Railway | **EnglishMind-backen:** Root Directory **trống**, Start `npm start`. Lỗi `server does not exist` = đang trỏ nhầm monorepo. |

> Nếu vẫn kẹt: chụp màn hình phần log đỏ trên Railway và phần Variables (che bớt giá trị bí mật), gửi lại để được hỗ trợ.

---

## 📌 Bạn cần chuẩn bị sẵn (tóm tắt)
- [ ] Tài khoản Google (để lấy Gemini key + Firebase)
- [ ] Tài khoản GitHub (chứa code) + tài khoản Railway (đăng nhập bằng GitHub)
- [ ] Quyền admin trên dự án Firebase EnglishMind
- [ ] Notepad để lưu tạm: GEMINI_API_KEY, nội dung json Firebase, URL server mới

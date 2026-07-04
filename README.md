# EnglishMind Backend (Pro AI proxy)

Node/Express server implementing the two release-blocking audit tasks:

- **T37-BE (R1)** — `POST /api/ai/generate` verifies the Firebase **ID token** and
  the caller's **entitlement** before calling Gemini. The Gemini API key lives
  only on the server.
- **T38-BE (R3)** — server-side **daily AI quota** keyed by `UID` + **server day**
  (timezone-aware), stored in Firestore. The client clock can no longer bypass it.

Content endpoints (`/api/curricula`, `/api/lesson/:id`, `/api/vocabulary`,
`/api/word/:w`, `/api/v1/tower/...`, `POST /api/progress`, `POST /api/lesson`)
are **proxied** to `CONTENT_UPSTREAM_URL` so the app keeps working without
re-hosting the content DB.

## Layout

```
server/
  package.json
  .env.example          # copy → .env (local) or set as Railway Variables
  src/
    index.js            # express app + routes
    firebase.js         # Firebase Admin init
    gemini.js           # server-side Gemini caller (holds API key)
    middleware/
      verifyAuth.js     # T37-BE: verify token + entitlement
      checkQuota.js     # T38-BE: reserve/refund daily quota
    routes/
      ai.js             # POST /api/ai/generate
      content.js        # content GET/POST → upstream proxy
      trial.js          # GET /api/trial-status/:installId
```

## Run locally

```bash
cd server
npm install
cp .env.example .env      # fill GEMINI_API_KEY + Firebase creds
npm run dev               # http://localhost:8080/healthz
```

For local Firebase auth, download a service-account key and either set
`FIREBASE_SERVICE_ACCOUNT` to its JSON or `GOOGLE_APPLICATION_CREDENTIALS` to
its path.

## Deploy to Railway

1. New service → Deploy from repo, **root directory = `server`**. Railway uses
   `server/Dockerfile` so `whisper-cli` and the default GGML model are available
   for server-side STT.
2. Set Variables (from `.env.example`): `GEMINI_API_KEY`, `GEMINI_MODEL`,
   `FIREBASE_SERVICE_ACCOUNT` (paste full JSON), `PRO_PROXY_DAILY_LIMIT`,
   `QUOTA_TIMEZONE`, `CONTENT_UPSTREAM_URL`, `TRIAL_HMAC_SECRET`.
   Keep `SERVER_STT_ENABLED=false` until the `/api/stt/transcribe` benchmark is
   under 5s for short clips; then set it to `true`.
3. Start command: `npm start` (Railway auto-detects). `PORT` is injected.
4. Point the app's `contentServerUrl` at the new Railway URL (Settings screen or
   `DataStoreManager` default).

### Server-side STT (VOICE-STT-SERVER-1)

`POST /api/stt/transcribe` is fail-closed by default. Required env:

| Variable | Default | Notes |
|---|---|---|
| `SERVER_STT_ENABLED` | `false` | Must be `true` to accept audio. |
| `WHISPER_BIN` | `/app/bin/whisper-cli` | Built by `server/Dockerfile`. |
| `WHISPER_MODEL` | `/app/models/ggml-base.bin` | Downloaded at Docker build time. |
| `STT_TIMEOUT_MS` | `20000` | Per-clip server timeout. |

Audio is accepted only with explicit `audioConsent=true`, limited to 1.5MB,
stored only as a temp file, and deleted after transcription. Logs are metadata
only; transcript is cached by `uid + sha256(audio)` in Firestore for 30 days.

## Entitlement model

A request to `/api/ai/generate` is allowed when the verified token has either:

- custom claim `admin: true`, **or**
- Firestore `users/{uid}/tier/current.tier` ∈ `{PRO, PRO_AI}`.

Otherwise → `403 no_entitlement`. Missing/invalid token → `401`.
Over quota → `429 quota_exceeded`. The client already understands
`{ success:false, error, errorMessage }`.

## Firestore (used by the server)

- `aiQuota/{uid}` = `{ date: "YYYY-MM-DD", count }` — daily counter (server day).
- `users/{uid}/tier/current` = `{ tier }` — entitlement source of truth.
- `trials/{installId}` = `{ startedAt }` — free-trial window.

Recommended security rules: clients must **not** be able to write `aiQuota/*`
or `users/*/tier/*` directly — only this server (Admin SDK bypasses rules):

```
match /aiQuota/{uid}    { allow read, write: if false; }
match /users/{uid}/tier/{doc} { allow read: if request.auth.uid == uid; allow write: if false; }
```

## Notes / follow-ups

- `PRO_PROXY_DAILY_LIMIT` is a safety cap against abuse (Pro users are otherwise
  "unlimited" on the client). Tune per cost budget.
- Quota fails **closed** (503) if Firestore is unreachable — prefer correctness
  over letting abuse through. Flip in `checkQuota.js` if you want fail-open.
- To stop depending on the old content server, replace `routes/content.js`
  proxying with real handlers backed by your own data.

## Beta Ops (task B1 — PLATFORM_SPEC §8, §11)

New endpoints (auth = `X-EnglishMind-Beta-Key` header, storage = **PostgreSQL**, schema
auto-created from `sql/001_beta_ops.sql` on first use):

| Endpoint | Notes |
|---|---|
| `GET /health` | `{ok, service, env}` — contract of `BetaOpsClient.kt` |
| `POST /v1/feedback` | category + message (+contact) → `beta_feedback` |
| `POST /v1/bug-report` | safe metadata only → `beta_bug_report` |
| `POST /v1/event` | eventType + safeMetadata (≤4KB) → `beta_event_log` |
| `POST /v1/ai/can-use` | device daily guard, **fail-open** when DB down |
| `POST /v1/ai/record-usage` | upsert `ai_usage_daily`, fail-soft |
| `POST /v1/admin/feedback-digest` | gửi **1 email tổng hợp** feedback N giờ gần nhất tới `FEEDBACK_NOTIFY_TO` (Cron) |

### Feedback → email owner (scale)

Không cần đọc Postgres/CLI khi có hàng trăm user:

1. Railway **Variables**: `FEEDBACK_NOTIFY_TO`, `SMTP_*`, `FEEDBACK_EMAIL_MODE=digest`
2. **Cron** (Railway hoặc cron-job.org), mỗi sáng 8h:

```bash
curl -s -X POST "https://YOUR-RAILWAY-URL/v1/admin/feedback-digest" \
  -H "X-EnglishMind-Beta-Key: YOUR_BETA_OPS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"hours":24}'
```

3. `FEEDBACK_EMAIL_MODE=instant` → mỗi feedback 1 email (chỉ beta nhỏ &lt;20/ngày).

Email tự ẩn SĐT/email trong nội dung nhạy cảm (privacy classifier).

Env vars:

- `BETA_OPS_KEY` — required, ≥24 chars (must equal client `BETA_OPS_API_SECRET`).
- `DATABASE_URL` — Railway PostgreSQL connection string. Missing → writes return
  503 `storage_unavailable`, can-use fails open.
- `PGSSL=require` — set when using Railway's public proxy URL.
- `BETA_DAILY_AI_LIMIT` (default 50), `BETA_OPS_RATE_LIMIT` (default 30/min/IP),
  `QUOTA_TIMEZONE` (default Asia/Ho_Chi_Minh — shared with checkQuota).

Security per §8.4: zod validation, helmet, rate limit, 64kb body cap on /v1,
no raw-body logging, no stacktraces in responses.

## STT server-side (VOICE-STT-SERVER-1 — Q6 owner 2026-06-12)

Whisper.cpp chạy trên server, model KHÔNG đóng vào APK. Endpoint `POST /api/stt/transcribe`
(Firebase auth + consent riêng + cache Firestore `sttCache/{uid}_{sha256}`).

Env cần để bật (mặc định TẮT — fail-closed):

| Env | Giá trị |
|---|---|
| `SERVER_STT_ENABLED` | `true` |
| `WHISPER_BIN` | đường dẫn binary `whisper-cli` (build từ ggerganov/whisper.cpp) |
| `WHISPER_MODEL` | đường dẫn model, khuyến nghị `ggml-base-q5_1.bin` (~60MB) |
| `STT_TIMEOUT_MS` | tùy chọn, default 20000 |

Deploy Railway: cần Dockerfile cài binary + tải model lúc build (KHÔNG commit model vào repo).
**Bắt buộc benchmark trước khi bật:** nếu >5s/clip 10s trên Railway shared CPU → chuyển model
`tiny-q5_1` hoặc queue async. Body request: `{ audioBase64, language: "vi"|"en"|"auto", audioConsent: true }`.
Privacy: audio ghi file tạm, xóa ngay sau transcribe; log metadata-only.

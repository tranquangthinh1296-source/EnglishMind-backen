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

1. New service → Deploy from repo, **root directory = `server`**.
2. Set Variables (from `.env.example`): `GEMINI_API_KEY`, `GEMINI_MODEL`,
   `FIREBASE_SERVICE_ACCOUNT` (paste full JSON), `PRO_PROXY_DAILY_LIMIT`,
   `QUOTA_TIMEZONE`, `CONTENT_UPSTREAM_URL`, `TRIAL_SIGNING_SECRET`.
3. Start command: `npm start` (Railway auto-detects). `PORT` is injected.
4. Point the app's `contentServerUrl` at the new Railway URL (Settings screen or
   `DataStoreManager` default).

## Entitlement model

A request to `/api/ai/generate` is allowed when the verified token has either:

- custom claim `admin: true`, **or**
- Firestore `users/{uid}/tier/current.tier` ∈ `{PRO, LIFETIME, PRO_AI}`.

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

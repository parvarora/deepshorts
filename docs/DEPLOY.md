# Deploying to Firebase + Cloud Run

The frontend (static build) deploys to **Firebase Hosting**. The backend (FastAPI + the
multi-agent pipeline) deploys as a container to **Cloud Run**. The browser calls Cloud Run
**directly** — not through a Firebase Hosting rewrite.

```
Browser ──▶ Firebase Hosting (deepshorts-6c29a.web.app)   — serves the static React app only
   │
   └──▶ Cloud Run service "deepshorts-api" (asia-south1)  — called directly for all /api/** calls
```

## Why direct, not a Hosting rewrite (a correction worth knowing)
The original version of this guide routed `/api/**` through a Firebase Hosting rewrite to
Cloud Run, so the browser would only ever see one origin and CORS wouldn't matter. **That
doesn't hold up in practice for this app:** Hosting's rewrite proxy is built for quick
request→response APIs, and this backend's generation takes 30-60+ seconds and streams live
progress the whole time (`/api/generate/stream`). The rewrite proxy buffers/times out before
that finishes, surfacing as a `502` with the live progress view never showing anything at all.
Calling Cloud Run directly avoids the proxy layer entirely — Cloud Run itself handles
long-lived streaming responses fine. The cost is that requests are now genuinely
cross-origin, so CORS has to allow it (handled already — see below).

## Why Cloud Run (not Cloud Functions directly)
Cloud Run supports long-lived streaming HTTP responses natively; it's also just a normal
container, so the existing `uvicorn` app runs unmodified.

## Prerequisites
- A Google Cloud project with billing enabled (Cloud Run free tier covers light/demo
  traffic, but the project must have billing enabled to deploy). We're using the
  existing Firebase project `deepshorts-6c29a`, which is the same GCP project.
- `gcloud` CLI installed and authenticated: `gcloud auth login`, `gcloud config set project deepshorts-6c29a`.
- `firebase` CLI installed and authenticated: `npm install -g firebase-tools`, `firebase login`.
- Your real `GEMINI_API_KEY` (never committed — see below).

**Windows/PowerShell note:** any flag value containing a comma (e.g. `--set-env-vars
KEY=a,KEY2=b`) must be wrapped in quotes, or PowerShell silently mangles it into one
broken value. Always quote multi-variable values exactly as shown below.

## 1. Enable the required GCP APIs (one-time)
```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project=deepshorts-6c29a
```

## 2. Deploy the backend to Cloud Run
Run from the **repo root** (the Dockerfile lives there on purpose — see its header
comment — because the backend reads `prompts/` and `directors/` as siblings of `backend/`):

```bash
gcloud run deploy deepshorts-api \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --set-env-vars "GEMINI_API_KEY=YOUR_REAL_KEY,GEMINI_MODEL=gemini-3.5-flash" \
  --project deepshorts-6c29a
```
`--source .` builds the root `Dockerfile` via Cloud Build automatically — no manual
`docker build`/`push` needed (works even without Docker installed locally).

**Why `--max-instances 1`:** the in-memory rate limiter (token bucket for Gemini's free
15 RPM / 1500 RPD) lives inside a single Python process. If Cloud Run scaled to multiple
instances, each would have its *own* limiter, and their combined request rate could
exceed what Gemini actually allows — causing confusing 429s our own limiter didn't
anticipate. Pinning to 1 instance keeps the limiter accurate. (Cloud Run's default
`--concurrency` already lets that one instance serve several requests in parallel,
which our limiter is thread-safe for.) Raise this only if you also build a shared
limiter (e.g. Redis-backed) — not needed at assignment/demo scale.

**More secure key handling (optional):** instead of `--set-env-vars` (which stores the
key in plaintext in the Cloud Run revision config), use Secret Manager:
```bash
echo -n "YOUR_REAL_KEY" | gcloud secrets create GEMINI_API_KEY --data-file=- --project=deepshorts-6c29a
gcloud run deploy deepshorts-api --source . --region asia-south1 --allow-unauthenticated \
  --max-instances 1 --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest --project deepshorts-6c29a
```

**Copy the service URL** printed at the end (e.g. `https://deepshorts-api-xxxxx-as.a.run.app`)
— you need it for the next step. If you ever lose it, recover it with:
```bash
gcloud run services describe deepshorts-api --region asia-south1 --project deepshorts-6c29a --format="value(status.url)"
```

## 3. Point the frontend at that URL
Open `frontend/.env.production` and replace the placeholder with the real URL from step 2:
```
VITE_API_BASE=https://deepshorts-api-xxxxx-as.a.run.app
```
(It ships with an obviously-fake placeholder on purpose — if you forget this step, the
app fails fast and loudly with a network error instead of hanging and then 502'ing.)

You only redo this step if the Cloud Run URL ever changes (it normally doesn't, across
ordinary redeploys of the same service name + region).

## 4. Build and deploy the frontend
```bash
cd frontend
npm install
npm run build        # uses .env.production automatically (now pointing at Cloud Run)
cd ..
firebase deploy --only hosting --project deepshorts-6c29a
```
If you want the **Share Drama** feature live, make sure `frontend/.env` (your local,
gitignored copy) has real `VITE_FIREBASE_*` values filled in *before* running
`npm run build` — Vite loads `.env` and `.env.production` together at build time, and
only the built static output in `frontend/dist` gets uploaded.

## 5. Verify
- Open the Hosting URL Firebase prints (or `https://deepshorts-6c29a.web.app`).
- Generate a script; you should immediately see the first "Reading the brief…" step in
  the live agent panel — if that appears right away, the direct-to-Cloud-Run call (and
  CORS) is working.
- `https://deepshorts-api-xxxxx-as.a.run.app/api/health` (your real Cloud Run URL) should
  return `{"status": "ok", ...}`.

## Redeploying after changes
- Backend changed → re-run the step-2 `gcloud run deploy` command (omit the
  `--set-env-vars`/`--set-secrets` flags on redeploys if the key hasn't changed; Cloud Run
  keeps existing env vars/secrets unless you override them).
- Frontend changed → re-run step 4 (`npm run build` + `firebase deploy --only hosting`).
- Prompts changed (`prompts/`, `directors/`) → these are baked into the backend image, so
  redeploy the backend (step 2) to pick them up.

## CORS (already handled, here's why)
The backend's `CORS_ORIGINS` defaults to `["*"]` (see `backend/app/config.py`) — safe here
because this is a public, unauthenticated, cookie-free API with no user sessions to leak
cross-origin. That's what makes calling Cloud Run directly from the Hosting-served
frontend work without any extra CORS setup. If you ever want to lock it down to just your
Hosting domain instead of `*`:
```bash
gcloud run services update deepshorts-api --region asia-south1 \
  --update-env-vars 'CORS_ORIGINS=["https://deepshorts-6c29a.web.app"]' \
  --project deepshorts-6c29a
```
(Single-quoted on purpose — the value contains double quotes that would otherwise need
escaping in PowerShell.)

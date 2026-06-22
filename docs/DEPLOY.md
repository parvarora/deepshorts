# Deploying to Firebase + Cloud Run

The frontend (static build) deploys to **Firebase Hosting**. The backend (FastAPI + the
multi-agent pipeline) deploys as a container to **Cloud Run**, which Firebase Hosting
proxies to via a rewrite rule — so in production the browser only ever talks to one
origin (the Hosting domain), with `/api/**` and `/assets/**` transparently forwarded to
Cloud Run. No CORS configuration is needed for this path.

```
Browser ──▶ Firebase Hosting (deepshorts-6c29a.web.app)
              ├── /            → frontend/dist (static React build)
              └── /api/**, /assets/** → rewrite → Cloud Run service "deepshorts-api"
                                                     (the FastAPI multi-agent backend)
```

## Why Cloud Run (not Cloud Functions directly)
The backend streams Server-Sent Events (`/api/generate/stream`) for the live agent
visualization. Cloud Run supports long-lived streaming HTTP responses natively; it's
also just a normal container, so the existing `uvicorn` app runs unmodified.

## Prerequisites
- A Google Cloud project with billing enabled (Cloud Run free tier covers light/demo
  traffic, but the project must have billing enabled to deploy). We're using the
  existing Firebase project `deepshorts-6c29a`, which is the same GCP project.
- `gcloud` CLI installed and authenticated: `gcloud auth login`, `gcloud config set project deepshorts-6c29a`.
- `firebase` CLI installed and authenticated: `npm install -g firebase-tools`, `firebase login`.
- Your real `GEMINI_API_KEY` (never committed — see below).

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
  --set-env-vars GEMINI_API_KEY=YOUR_REAL_KEY,GEMINI_MODEL=gemini-3.5-flash \
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

Note the **service URL** printed at the end (e.g. `https://deepshorts-api-xxxxx-as.a.run.app`) —
you don't need to use it directly; `firebase.json` already points at the service by name
(`deepshorts-api`) and region (`asia-south1`).

## 3. Build and deploy the frontend
```bash
cd frontend
npm install
npm run build        # uses .env.production automatically (relative API paths)
cd ..
firebase deploy --only hosting --project deepshorts-6c29a
```
If you want the **Share Drama** feature live, make sure `frontend/.env` (your local,
gitignored copy) has real `VITE_FIREBASE_*` values filled in *before* running
`npm run build` — Vite loads `.env` and `.env.production` together at build time, and
only the built static output in `frontend/dist` gets uploaded.

## 4. Verify
- Open the Hosting URL Firebase prints (or `https://deepshorts-6c29a.web.app`).
- Generate a script; watch the live agent panel — this proves the SSE stream is working
  through the Hosting → Cloud Run rewrite.
- `https://deepshorts-6c29a.web.app/api/health` should return `{"status": "ok", ...}`.

## Redeploying after changes
- Backend changed → re-run the step-2 `gcloud run deploy` command (omit the
  `--set-env-vars`/`--set-secrets` flags on redeploys if the key hasn't changed; Cloud Run
  keeps existing env vars/secrets unless you override them).
- Frontend changed → re-run step 3 (`npm run build` + `firebase deploy --only hosting`).
- Prompts changed (`prompts/`, `directors/`) → these are baked into the backend image, so
  redeploy the backend (step 2) to pick them up.

## Optional hardening
If you ever call the Cloud Run URL *directly* (bypassing the Hosting rewrite — e.g. while
debugging), add the Hosting domain to CORS:
```bash
gcloud run services update deepshorts-api --region asia-south1 \
  --update-env-vars 'CORS_ORIGINS=["https://deepshorts-6c29a.web.app"]' \
  --project deepshorts-6c29a
```
Not required for the normal Hosting-rewrite flow (same-origin, no CORS involved).

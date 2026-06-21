# 🎬 AI Bollywood Script Generator

Turn an ordinary real-world situation into an absurd, over-engineered Bollywood/Hollywood movie —
title, tagline, characters, and a multi-scene script — via a resilient **multi-agent** pipeline.

> "Fight between two founders over putting sugar in coffee" → **SUGAR KA SHRAAP** → a full blockbuster.

## Architecture at a glance
```
React + Vite (frontend)  ──HTTP/SSE──▶  FastAPI (backend)  ──▶  LangGraph pipeline  ──▶  Gemini 3.5 Flash
   localStorage history                  /api/generate(/stream)     Architect → Screenwriter
   live agent-thinking view              /api/regenerate            → Script Doctor ⟲ (bounded) → Finalize
   Firebase share (optional)             /api/options, /api/pipeline
```
- **Backend:** [`backend/`](backend/) — multi-agent orchestration, rate-limit resilience, structured
  output, observability. See [`backend/README.md`](backend/README.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Frontend:** [`frontend/`](frontend/) — cinematic, responsive UI. See [`frontend/README.md`](frontend/README.md).
- **Prompts:** [`prompts/`](prompts/) — composable base prompt + a **mood library** (16) and a
  **director library** (10) injected per request.
- **Research:** [`research/`](research/) — the "anatomy of belovedness" craft study behind the Critic.

## Run it
**1. Backend**
```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env        # add your real GEMINI_API_KEY
uvicorn app.main:app --reload --port 8000
```
**2. Frontend** (new terminal)
```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_BASE=http://localhost:8000 (Firebase optional)
npm run dev                 # http://localhost:5173
```

## Assignment coverage
**Mandatory**
- ✅ Situation input → scene-level output
- ✅ LLM multi-agent system → movie title, tagline, multi-scene script
- ✅ Every scene has scene index + description + dialogue
- ✅ Proper error handling (typed errors, retries, repair, graceful degradation)
- ✅ Responsive UI
- ✅ Past history stored locally (localStorage)

**Bonus**
- ✅ Character cards (name, role, description)
- ✅ Mood selection (16-mood dropdown + Random Madness fusion)
- ✅ Regenerate specific section (title / tagline / scene / dialogue / recast / everything)
- ✅ Share a drama card (public `/drama/:id` link via Firebase)
- ✨ **Show Agent Thinking** — live multi-agent pipeline visualization (SSE)
- ✨ **Director's vision** — write the film in the style of a chosen filmmaker

## Security
No secrets are committed. Both apps ship `.env.example` with dummy values; real keys go in
gitignored `.env` files. Firebase web config is also kept in `.env`.

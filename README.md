# 🎬 DeepShorts — AI Bollywood Script Generator

Hand it an ordinary, everyday situation. It hands back an absurd, over-engineered
Bollywood/Hollywood **blockbuster** — title, tagline, cast, and a multi-scene script with
Hinglish dialogue — built by a resilient **multi-agent** pipeline that you can watch think in
real time.

> _"Roommate ate the last Maggi"_ → **MAGGI KA INTEQAAM** → _"Agar Maggi khaoge, toh maar bhi khaoge!"_ → a full action-drama.

**▶ Live demo:** https://deepshorts-6c29a.web.app

---

## ✨ What it does

- **Situation → movie.** One line in; a complete film out — title, tagline, logline, character
  cast, and an escalating multi-scene script (each scene: heading, English staging description,
  and Hindi-led **Hinglish** dialogue).
- **Watch the writers' room think.** A live panel streams each agent's step as it runs
  (Architect → Screenwriter → Script Doctor → Finalize) over a **WebSocket**.
- **Mood control.** 16 moods (Maximum Drama, Noir Thriller, Comedy Chaos, Epic Tragedy…) plus a
  **Random Madness** fusion toggle. Mood is authoritative over the film's register.
- **Director's vision.** Write the film "in the style of" one of 10 Indian filmmakers
  (Rohit Shetty, S. L. Bhansali, Anurag Kashyap, Rajkumar Hirani, Raj & DK…).
- **Regenerate any part** — title, tagline, a single scene, just the dialogue, the cast, or the
  whole thing — with the rest of the script locked as canon.
- **Local history** (localStorage) and a **shareable public link** for any drama (Firestore-backed
  `/drama/:id`).

---

## 🏗️ Architecture at a glance

```
 ┌─────────────────────────┐         ┌──────────────────────────┐        ┌────────────────────┐
 │  React + Vite + TS       │  WSS    │  FastAPI  (Cloud Run)    │        │  LangGraph pipeline │
 │  • cinematic, responsive │◀──────▶ │  /api/generate/ws  (live)│ ─────▶ │  Architect          │
 │  • live agent panel      │  HTTPS  │  /api/generate     (full)│        │   → Screenwriter    │
 │  • localStorage history  │◀──────▶ │  /api/regenerate         │        │   → Script Doctor ⟲ │
 │  • Firestore share link  │         │  /api/options /health    │        │   → Finalize        │
 └─────────────────────────┘         └──────────────────────────┘        └─────────┬──────────┘
        Firebase Hosting                                                            │
                                                              every call ▼  hardened Gemini client
                                                        rate-limit → think → retry → parse → validate
                                                                            ▼
                                                                   ✨ Gemini 2.5 Flash
```

| Part | Where | Notes |
|---|---|---|
| **Frontend** | [`frontend/`](frontend/) | React + Vite + TypeScript, Framer Motion, light/dark themes. See [`frontend/README.md`](frontend/README.md). |
| **Backend** | [`backend/`](backend/) | FastAPI + LangGraph orchestration, rate-limit resilience, structured output, observability. See [`backend/README.md`](backend/README.md). |
| **Prompts** | [`prompts/`](prompts/) | One composable base prompt + a **mood library (16)** and **director library (10)** injected per request. |
| **Docs** | [`docs/`](docs/) | [Architecture](docs/ARCHITECTURE.md) · [Deploy guide](docs/DEPLOY.md) · visual infographics (below). |

### 📊 Infographics
- **System prompt composition** — [PDF](docs/system-prompt-infographic.pdf) · [HTML](docs/system-prompt-infographic.html)
- **AI architecture** — [PDF](docs/ai-architecture-infographic.pdf) · [HTML](docs/ai-architecture-infographic.html)

---

## 🧠 How the AI works

**A LangGraph state machine drives three narrow agents through an always-on critic loop:**

```
START → dispatch → Architect → Screenwriter → Script Doctor ⟲ (revise, bounded) → Finalize → END
```

- **Architect** designs the blueprint — title, tagline, logline, characters (each with a want,
  fear, contradiction), and an escalating scene plan. *It decides how many scenes the drama earns.*
- **Screenwriter** writes every scene (staging + Hinglish dialogue) from the blueprint in one call.
- **Script Doctor (Critic)** scores escalation / consistency / register-fit / memorability and
  either passes the script or returns concrete fixes — looping back, hard-bounded by
  `MAX_ITERATIONS` (loop guard).

Every model call funnels through **one hardened Gemini client**: rate-limit gate → thinking
(with captured thought summaries) → retry-with-backoff → tolerant JSON parse → Pydantic validate
(+ one structured repair). Agents stay simple; all resilience lives in that choke point.

**Composable system prompt.** The base "world-bible" prompt has two injection slots filled from
the dropdowns — `MOOD_DIRECTION` (the register, authoritative) and `DIRECTOR_PROFILE` (the voice).
The shared voice is injected once; each agent then appends only its own narrow role + JSON schema.

> Built for Gemini's free tier (15 RPM / 1500 RPD on `gemini-2.5-flash`): few smart agents, a
> whole-script-per-call screenwriter, a token-bucket limiter that throttles *before* 429s, and
> graceful degradation when a sub-call fails. Pinned to one Cloud Run instance so the in-memory
> limiter stays accurate.

---

## 🚀 Run it locally

**1. Backend**
```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add your real GEMINI_API_KEY (never commit it)
uvicorn app.main:app --reload --port 8000
```
Interactive API at http://localhost:8000/docs.

**2. Frontend** (new terminal)
```bash
cd frontend
npm install
cp .env.example .env          # VITE_API_BASE=http://localhost:8000  (Firebase keys optional, for sharing)
npm run dev                   # http://localhost:5173
```

Get a free Gemini key at https://aistudio.google.com/apikey. The "Share Drama" feature needs
Firebase keys in `frontend/.env` (`VITE_FIREBASE_*`) and a Firestore database — see
[`docs/DEPLOY.md`](docs/DEPLOY.md). Everything else runs without them.

## ☁️ Deploy

Frontend → **Firebase Hosting**, backend → **Google Cloud Run** (the browser calls Cloud Run
directly; live progress rides a WebSocket). Full step-by-step in [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## ✅ Assignment coverage

**Mandatory**
- ✅ Situation input → scene-level output
- ✅ LLM multi-agent system → movie title, tagline, multi-scene script
- ✅ Every scene has scene index + description + dialogue
- ✅ Robust error handling (typed errors, retries, one-shot repair, graceful degradation)
- ✅ Responsive UI (light/dark)
- ✅ Past history stored locally (localStorage)

**Bonus**
- ✅ Character cards (name, role, description)
- ✅ Mood selection (16-mood dropdown + Random Madness fusion)
- ✅ Regenerate specific section (title / tagline / scene / dialogue / recast / everything)
- ✅ Share a drama card (public `/drama/:id` link via Firebase Firestore)
- ✨ **Show Agent Thinking** — live multi-agent pipeline visualization (WebSocket)
- ✨ **Director's vision** — write the film in the style of a chosen filmmaker

---

## 🔐 Security

No secrets are committed. Both apps ship `.env.example` with **dummy** values; real keys live only
in gitignored `.env` files (and, in production, in Cloud Run env vars / Firestore config). The
**Gemini API key is never committed** — not in any file, not in git history. The Firebase *web*
config (`VITE_FIREBASE_*`) is a public client identifier by design and is protected by Firestore
security rules, not by secrecy.

## 📁 Repository layout

```
deepshorts/
├── backend/      FastAPI + LangGraph multi-agent pipeline   (see backend/README.md)
├── frontend/     React + Vite + TS cinematic UI             (see frontend/README.md)
├── prompts/      composable base prompt + moods/ + directors/
├── docs/         ARCHITECTURE.md · DEPLOY.md · infographics (HTML + PDF)
├── research/     the craft study behind the Script Doctor
└── Dockerfile    backend container image (root context, builds for Cloud Run)
```

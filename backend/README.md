# Backend — AI Bollywood Script Generator

A resilient multi-agent pipeline (LangGraph + Gemini 2.5 Flash) that turns an ordinary
situation into a dramatic, over-engineered multi-scene movie.

## Quick start
```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash; use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # then put your real GEMINI_API_KEY in .env (never commit it)
uvicorn app.main:app --reload --port 8000
```
Open http://localhost:8000/docs for the interactive API.

## The pipeline (Pixar model, not "six writers")
```
START → dispatch → Architect → Screenwriter → Script Doctor ⟲ (revise, bounded) → Finalize → END
```
- **Architect** designs the blueprint: title, tagline, logline, characters (want/fear/contradiction),
  and an escalating scene plan. *It decides how many scenes the drama needs — no fixed bound.*
- **Screenwriter** writes every scene (description + dialogue) from the blueprint.
- **Script Doctor (Critic)** scores escalation / consistency / register fit / memorability and either
  passes or returns concrete fixes. **Always on**, hard-bounded by `MAX_ITERATIONS` (loop guard).
- **Finalize** assembles the `Script`.

Regeneration re-enters the graph at a single node with the rest of the script **locked as canon**.

## Why it's built for the free tier (15 RPM / 1500 RPD)
- **Few, smart agents** (3 LLM roles) instead of many tiny ones → fewer hops, less error compounding.
- **Whole-script-per-call** (all scenes in one Screenwriter call) instead of one call per scene.
- A full generation is ~3 calls + up to `MAX_ITERATIONS` revisions (each = 2 calls). Worst case ≈ 7.
- **Token-bucket rate limiter** (`RPM_LIMIT`) throttles *before* 429s; **daily counter** (`RPD_LIMIT`).
- **Retry-with-backoff** on 429/5xx as the safety net.
- **Pass each agent only what it needs** (no full-history bloat).

## Resilience / error handling
- **Structured handoffs:** every agent output is validated against a Pydantic schema; on malformed
  output we do ONE structured repair re-ask, then fail gracefully (`AgentError`).
- **Loop guard + best-effort:** if the critic loop doesn't converge, we ship the best draft
  (`meta.converged = false`).
- **Graceful endpoints:** typed JSON errors (`429` rate limit, `502` agent, `500` server) — the
  app never crashes on one bad sub-call.

## Observability
Every model call logs the full prompt, raw response, thought summary, and latency to
`logs/<date>.jsonl`, keyed by `request_id` + agent. A per-run `trace[]` is returned in `meta`.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | liveness + config sanity (model, key present, counts) |
| GET | `/api/options` | moods + directors for the dropdowns |
| GET | `/api/pipeline` | static agent graph (for the UI agent-visualization) |
| POST | `/api/generate` | situation (+mood/director) → full `Script` + `meta` |
| WS | `/api/generate/ws` | **live per-agent events** over a WebSocket (the transport the deployed UI uses) |
| POST | `/api/generate/stream` | same events as **SSE** (kept for local dev / non-proxied callers) |
| POST | `/api/regenerate` | regenerate one section: `title` / `tagline` / `scene` / `dialogue` / `characters` |

### Generate
```jsonc
POST /api/generate
{ "situation": "Two founders fighting over putting sugar in coffee",
  "mood": "corporate-war",            // optional; id from /api/options (default: maximum drama)
  "director": "anurag-kashyap" }       // optional; id from /api/options
```
Response: `{ ok, script, meta }`. `meta` carries `request_id, converged, score, iterations,
situation, mood, director, title, trace[]` — everything the client needs for **history** and
**regeneration**.

### Regenerate (per-section buttons)
```jsonc
POST /api/regenerate
{ "script": { ...the Script from history... },
  "target": { "type": "scene", "index": 3 },   // or {"type":"title"} / {"type":"dialogue","index":2} / {"type":"characters"}
  "mood": "corporate-war", "director": "anurag-kashyap",
  "note": "make it angrier" }                    // optional steer
```
"Regenerate everything" = the client simply re-calls `/api/generate` with the stored
`situation`/`mood`/`director`.

## State & regeneration (design note)
There is **no server-side persistence**. The client stores each `Script` in `localStorage`
(history) and round-trips it back as `canon_script` for regeneration. The graph initializes a
fresh, self-contained state per request — so consistent regeneration works without a database,
exactly matching the assignment's "store locally" requirement.

## Layout
```
app/
├── main.py            # FastAPI endpoints
├── config.py          # settings (.env)
├── schemas.py         # Pydantic contract (structured handoffs)
├── prompts_loader.py  # compose base + mood + director voice
├── agents.py          # Architect / Screenwriter / Critic / regen agents
├── llm/
│   ├── client.py      # Gemini wrapper: thinking, parse+repair, retry/backoff
│   └── rate_limiter.py# token bucket + daily cap
├── graph/
│   ├── state.py       # ScriptState
│   └── pipeline.py    # LangGraph nodes, loop, routing, streaming
└── observability/
    └── logger.py      # full prompt/response logging
```

# DeepShorts — Interview Prep / Full Codebase Walkthrough

This is the "explain anything in this project" document. It's organized so you can read it
top to bottom for a full mental model, or jump to a section right before being asked about it.
Every section answers **what it is**, **how it works**, and **why it was built that way** —
the "why" is what separates a memorized answer from an understood one.

---

## 1. The one-liner

> You type an ordinary situation ("roommate ate my last Maggi"). A multi-agent LLM pipeline
> turns it into a complete, absurdly over-engineered Bollywood/Hollywood movie — title,
> tagline, character cast, and a multi-scene script with Hinglish dialogue — and streams the
> writers'-room process to you live, agent by agent, over a WebSocket.

It's a DeepShorts take-home assignment. Mandatory requirements: situation → scene-level
script output, multi-agent system, robust error handling, responsive UI, local history.
Bonus features implemented: character cards, mood selection, per-section regeneration,
shareable public link, **and** two stretch features — live "agent thinking" visualization,
and a "director's vision" style control.

---

## 2. The 30-second architecture

```
Browser (React)  ──WebSocket──▶  FastAPI (Cloud Run)  ──▶  LangGraph state machine
     │                                                            │
     │ localStorage (history)                          Architect → Screenwriter → Critic ⟲
     └─ Firestore (optional, for "Share Drama")                   │
                                                          every LLM call ▼
                                                   single hardened Gemini client
                                                   rate-limit → think → retry → parse → validate
                                                                   │
                                                            Gemini 2.5 Flash
```

Two deployable halves, one repo:
- **`frontend/`** — React + Vite + TypeScript, deployed to Firebase Hosting (static).
- **`backend/`** — FastAPI + LangGraph, deployed to Google Cloud Run (container).

The browser talks **directly** to Cloud Run (not through a Hosting rewrite/proxy) — more on
why under §8 (Streaming).

---

## 3. The core idea: three narrow agents, not "six writers"

The single most important design decision in this project. Early planning (see
`docs/ARCHITECTURE.md`, which is the original brainstorm and is intentionally left as a
historical record) considered 6 nodes: Story Architect, Character Forge, Scene Generator,
Dialogue Punch-Up, Critic, Structural Validator. What actually shipped collapsed this to
**three LLM agents** plus deterministic code:

| Agent | File | Job |
|---|---|---|
| **Architect** | `backend/app/agents.py` → `architect()` | Pre-production: title, tagline, logline, full character roster (with want/fear/contradiction), and an escalating scene-by-scene **plan** (not prose yet) |
| **Screenwriter** | `agents.py` → `screenwriter()` | Writes every scene in full (staging description + Hinglish dialogue) from the blueprint, in **one call** |
| **Script Doctor (Critic)** | `agents.py` → `critic()` | Reads the assembled script and scores it; either passes it or returns concrete, scene-by-scene fixes |

**Why fewer, bigger agents instead of many tiny ones (this is the answer to "why this
architecture and not something more granular"):**
1. **Error compounding.** Every agent hand-off is a place a small mistake (wrong character
   name, broken continuity) can get passed forward and amplified. Fewer hops = fewer chances
   to drift, especially important because this runs on a **free-tier, comparatively fast/cheap
   model** (Gemini 2.5 Flash), not a top-tier reasoning model.
2. **Rate-limit economics.** The free tier is the real constraint (15 requests/minute, 1500/day).
   Six agents × scene-by-scene calls would burn the daily quota on a handful of generations.
   Three agents, with the Screenwriter writing **all scenes in one call** instead of one call
   per scene, means a full generation costs **~3 calls best case, ~7 worst case** (see §6).
3. **Single Responsibility still holds at 3.** Architect *designs*, Screenwriter *writes*,
   Critic *judges*. That's still "Pixar model" separation of concerns — just sized to the
   actual model and budget instead of an idealized org chart.
4. **The "Structural Validator" node didn't need to be an LLM node** — Pydantic validation
   already happens deterministically inside the Gemini client wrapper for every call (§5). No
   reason to spend an LLM call on something code does for free, instantly, and more reliably.

---

## 4. The LangGraph state machine

File: `backend/app/graph/pipeline.py`. This is the orchestration layer — it does **not** call
Gemini directly; it calls the agent functions from `agents.py`, which call the Gemini client.

### 4.1 The full-generation graph

```
START → dispatch → architect → screenwriter → critic ─┬─(not passed & budget left)─▶ screenwriter (loop)
                                                        └─(passed OR budget exhausted)─▶ finalize → END
```

- **`dispatch`** — a router/setup node. It composes the "voice" (shared system context: base
  prompt + mood block + director block, see §7) **once**, and resets `iteration = 0`. It also
  decides which graph branch to take based on `mode` (full generation vs. one of 4 regeneration
  modes — see §4.2).
- **`architect`** — calls `agents.architect()`, gets back a validated `Blueprint`, stores it in
  state.
- **`screenwriter`** — calls `agents.screenwriter()`. On the **first** pass there's no critique,
  so it writes fresh from the blueprint. On a **revision** pass (loop re-entry), it additionally
  receives its own previous scenes *and* the critic's structured issue list, and is told
  explicitly to preserve what works and fix only what's flagged.
- **`critic`** — calls `agents.critic()` on the fully assembled script (title+characters+scenes
  all together, so it can judge cross-scene escalation/consistency, not just one scene in
  isolation). Returns `{passed, score, issues[], note}`.
- **Routing after critic** (`route_after_critic` in `pipeline.py`):
  - if `passed` → go straight to `finalize`
  - if not passed **and** `iteration <= max_iterations` (default 2) → loop back to
    `screenwriter` with the critique attached
  - if not passed **and** the iteration budget is exhausted → go to `finalize` anyway
    (**"best-effort, not best-blocked"** — `meta.converged = false` tells the client the script
    shipped without the critic's full sign-off, but the user still gets a complete script
    instead of an error)
- **`finalize`** — pure assembly: sorts scenes by index, builds the final `Script` Pydantic
  object, no LLM call.

**Why is the critic loop "always on" instead of optional or skippable?** Because quality
control is the cheapest insurance available — at most 2 extra round trips — against a script
that has an inconsistency or a weak ending, which would be the single most visible quality
failure to a user/grader. It's hard-bounded so a stubborn disagreement between critic and
screenwriter can never produce an infinite loop or runaway cost; the loop guard (`iteration >
max_iterations`) always wins eventually and ships *something*.

### 4.2 Regeneration: the same graph, a different door

```
START → dispatch → regen_scene | regen_dialogue | regen_meta | regen_characters → END
```

Each regen node is a **single focused agent call** — it does not re-run the whole pipeline.
The trick that makes "regenerate just this scene, keep everything else exactly the same" work
**without a database**: the client sends back the entire current `Script` (round-tripped from
its own `localStorage` history) as `canon_script`. The regen node:
- builds a prompt that explicitly lists the **other** scenes as "LOCKED CANON — do not change"
- asks the model to rewrite only the targeted slice (one scene, one scene's dialogue, the
  title/tagline/logline trio, or the character roster)
- splices the single new piece back into the untouched `Script` object in Python (not by
  asking the model to repeat the whole script back)

This is why `ScriptState` (`backend/app/graph/state.py`) is explicitly documented as **stateless
across requests** — there is no server-side persistence at all. Every request builds a fresh
state dict; the only "memory" in the whole system is the browser's `localStorage`. This was a
deliberate fit to the assignment's "store past generations locally" requirement: rather than
add a database whose only job would be remembering the canon script between requests, the
canon script is just... sent back each time. Simpler, and exactly matches the spec.

### 4.3 `ScriptState` — the one object threaded through every node

```python
class ScriptState(TypedDict, total=False):
    request_id, mode                      # identity/routing
    situation, mood, director,
    characters_hint, note, voice_system    # inputs (voice_system = composed prompt)
    blueprint, scenes, critique,
    iteration, converged                   # full-generation working memory
    canon_script, target_index             # regeneration working memory
    script, trace, errors                  # output + observability
```

Every node returns a **partial dict** (LangGraph merges it into state — this is just how
`StateGraph` works: a node's return value is shallow-merged into the running state). Every
node also appends one entry to `trace` (`{step, status, ts, ...detail}`) — this is what powers
the live "Agent Thinking" panel in the UI (§8) and the after-the-fact `meta.trace[]` returned
with every response.

---

## 5. The hardened Gemini client — the single choke point

File: `backend/app/llm/client.py`. **This is the file most worth being able to explain in
detail** — it's where almost all the "robust error handling" requirement actually lives, and
it's deliberately the *only* place that talks to the Gemini API. Every agent calls
`client.generate_json(...)`; none of them touch retries, parsing, or rate limiting themselves.
Keeping agents this simple is itself a design decision: it means a new agent (e.g. a future
"poster tagline" agent) gets all this resilience for free just by calling the same method.

`generate_json()` does, **in order**, for every single call:

1. **Rate-limit gate** (`RateLimiter.acquire()`, see §6) — blocks *before* spending a request,
   so we throttle ourselves instead of waiting to get a 429 back.
2. **The actual call**, with Gemini's "thinking" mode turned on (`ThinkingConfig
   (include_thoughts=True)`) — the model's reasoning is captured as a separate "thoughts" text
   stream, not mixed into the answer. This is purely for **observability** (logged per call, see
   §9); it isn't shown to the end user.
3. **Retry with exponential backoff + jitter** on retryable failures: 429 (rate limit), 5xx,
   "unavailable", "overloaded", "deadline"/"timeout". Up to 5 attempts
   (`min(2**attempt + random(), 30s)` backoff). Non-retryable errors (e.g. a genuinely bad
   request) raise immediately — no point retrying those.
   - One extra subtlety: if the *thinking config itself* is rejected by the model/SDK version
     (a string match on "thinking" in the exception), the client **disables thinking and
     retries** rather than failing outright — graceful feature-degradation instead of a hard
     crash over an optional feature.
4. **Tolerant JSON extraction** (`_extract_json`) — LLMs don't always return clean JSON. This
   strips `<think>...</think>` tags and Markdown code fences, then does a **manual brace-depth
   scan** (counting `{`/`}` while respecting string boundaries and escaped quotes) to pull out
   the first **balanced** JSON object, rather than trusting `json.loads` on the raw text or
   relying on regex (which breaks on nested braces). This is hand-rolled because Gemini's
   `response_mime_type`/`response_schema` native structured-output mode was *not* used here
   (the original plan in `docs/ARCHITECTURE.md` mentions it as an option) — the shipped client
   does prompt-based JSON requesting + defensive parsing instead, which is more portable across
   model/SDK versions and doesn't require trusting that "native" mode never produces malformed
   output.
5. **Pydantic validation against the target schema.** If it doesn't validate (`ValidationError`)
   or no JSON was found at all (`ValueError`), the client does **exactly one structured "repair"
   re-ask**: it sends the model its own broken output, the exact validation error, and the JSON
   schema again, and asks for a corrected version only. If *that* also fails to validate, the
   client gives up and raises `AgentError` — this is the **one** place malformed output is
   allowed to actually fail the request, and it only happens after two genuine attempts.
6. **Full observability logging** on every call and every repair attempt (§9) — system prompt,
   user prompt, raw response, thought summary, latency.

**Why "one structured repair, then fail" instead of looping until valid, or just retrying the
whole call?** Looping indefinitely risks burning the rate-limit budget chasing a model that's
fundamentally not going to produce valid output for that input. One repair attempt catches the
overwhelmingly common case (a stray trailing comma, a field that should've been a list,
slightly wrong nesting) cheaply, while still failing fast and clearly (`AgentError` → the API
returns a typed `502 agent` error) if something is structurally wrong, so the failure is
diagnosable instead of an infinite hang.

---

## 6. Rate limiting — designing for the free tier, not just handling 429s

File: `backend/app/llm/rate_limiter.py`. A **thread-safe token bucket** plus a **daily counter**:

- **Token bucket (RPM):** capacity = `rpm_limit` (12, configurable, under Gemini's real 15
  RPM free-tier ceiling), refills continuously at `rpm/60` tokens/second. `acquire()` blocks
  (sleeping outside the lock, then re-checking) until a token is available.
- **Daily counter (RPD):** resets when `time.strftime("%Y-%m-%d")` rolls over; if the count for
  today has hit `rpd_limit` (1400, under the real 1500/day ceiling), `acquire()` raises
  `RateLimitExceeded` immediately rather than sleeping — there's no point waiting hours for a
  daily cap to reset mid-request, so this fails fast with a clear, typed error instead of
  hanging.

**Why self-throttle below the documented limits instead of just retrying on 429?** Two reasons,
both learned the hard way during this project's debugging:
1. **429 retries still cost wall-clock time and can cascade** — if every one of 3-7 calls in a
   generation has to back off and retry, a single generation can take much longer and *still*
   risk hitting the daily cap before finishing. Throttling proactively keeps the steady-state
   request rate under the ceiling so 429s become rare instead of routine.
2. **A real incident:** during deployment, generations started failing with `429
   RESOURCE_EXHAUSTED` partway through (after ~3 successful steps). Investigation of the actual
   Cloud Run logs and the quota error's `quotaId` field (`GenerateRequestsPerDayPerProjectPerModel-
   FreeTier`) proved this was a **per-day**, **per-project**, **per-model** cap — not a per-minute
   cap as some early hypotheses (and even some web docs) suggested. The model in use at the time,
   `gemini-3.5-flash`, had a much smaller free daily allowance (~20/day) than the older
   `gemini-2.5-flash` (1500/day). The fix was switching the default model
   (`backend/app/config.py: gemini_model`) to `gemini-2.5-flash` — *not* a code change to the
   limiter at all. This is a good interview story: it shows the difference between treating a
   symptom (retry harder) and diagnosing the actual root cause (wrong model for the available
   quota) from raw evidence (the quota ID string, the timing pattern of failures, and a
   request-count audit against the logs).
- **Why a single Cloud Run instance (`--max-instances 1`)?** The rate limiter's state (the token
  bucket, the daily counter) lives **in process memory** — it is not shared across instances.
  If Cloud Run ever scaled to 2+ instances, each would have its own independent budget, and the
  *combined* real request rate to Gemini could silently exceed the actual account-wide quota.
  Pinning to one instance is what keeps the in-memory limiter's accounting honest. (The
  trade-off — no horizontal scaling, one cold-start path — is acceptable for a single-user demo
  app on a free tier; a production system would move this state to Redis or similar instead.)

---

## 7. The prompt system — one composable base, two injection slots

This is the part of the project that is "the AI" in the most literal sense, and worth being
able to walk through carefully.

### 7.1 The three layers

```
prompts/script_generator.system.md     ← the base "world bible" (craft rules, language rules,
                                          JSON contract) — ALWAYS included
        + MOOD_DIRECTION slot          ← filled from prompts/moods/<id>.md   (16 files)
        + DIRECTOR_PROFILE slot        ← filled from prompts/directors/<id>.md (10 files)
```

`backend/app/prompts_loader.py: compose_voice(mood, director)` does the assembly:
1. Reads the base file.
2. If a mood id was given and a matching file exists, replaces the `MOOD_DIRECTION` slot.
3. If a director id was given and a matching file exists, replaces the `DIRECTOR_PROFILE` slot.
4. **Truncates** the result at the `# What you receive` heading — the base file *also* contains
   a single-shot I/O contract (meant for a hypothetical one-shot version of the generator), but
   the actual multi-agent system doesn't use it: **each agent appends its own narrow role +
   JSON schema on top of this shared "voice" context instead.** So `compose_voice()`'s output is
   really just the shared *creative* context (identity, craft rules, language rules, mood,
   director) — not a complete prompt by itself.
5. Strips HTML comments (the slot markers and authoring notes) so none of that scaffolding
   leaks into the actual prompt sent to the model.
6. **Cached** with `@lru_cache(maxsize=64)` — since there are only 16 moods × 10 directors (+
   "no selection") combinations, caching the assembled string avoids re-reading and
   re-processing the same files on every request for a popular combination.

Then in `agents.py`, every agent call does `voice + "\n\n" + ROLE_PROMPT` — e.g. the Architect's
system prompt is "shared voice/craft context" + "`ARCHITECT_ROLE`" (its own narrow job
description). The Screenwriter's is "shared voice" + `SCREENWRITER_ROLE` (or `REVISE_ROLE` on a
revision pass). **Each agent gets exactly what it needs — no shared conversation history, no
other agents' raw outputs beyond the specific structured fields it's handed (e.g. the
Screenwriter receives the `Blueprint` object, not "everything the Architect ever said").**

### 7.2 Why slots, and why mood is "authoritative"

The base prompt explicitly states the relationship: **mood = what kind of film** (genre,
emotional key — a thriller withholds, a comedy accelerates, a tragedy lingers), **director =
how it's told** (voice, recurring techniques, sensibility). "You tell *this* mood's story
through *this* director's mind." When only one is picked, it leads; when neither is picked,
the model's own judgment chooses, defaulting toward "Maximum Drama" (the absurd-blockbuster
register that matches the assignment's headline pitch). This separation is why a Sanjay Leela
Bhansali-style film can be written in a "Comedy Chaos" register *or* a "Tragic Masterpiece"
register without the two libraries needing to know about each other — they're orthogonal axes
composed at request time, not 160 pre-written mood×director combinations.

### 7.3 The Hinglish language rule

Repeated verbatim (`LANGUAGE_RULE` in `agents.py`, and again in the base prompt) at every agent
that touches dialogue: scene descriptions are in clear English (staging/action), but **every
dialogue line must be majority-Hindi, Roman script, with English only for modern/technical/
business loanwords** ("vision," "startup," "deadline," "fix kar"). This is stated as
"non-negotiable" and repeated identically across the Architect/Screenwriter/Critic/regen
prompts rather than written once and assumed to carry over — because each agent's system prompt
is assembled independently (§7.1), so a rule that matters everywhere has to be **physically
present** in every relevant prompt, not just stated once and trusted to propagate. The Critic
is also explicitly told to flag any line that's plain English as an issue to fix — language
correctness is a quality-gate criterion, not just an instruction hoped to be followed.

### 7.4 A real bug this system produced — the giant text box

During testing, the rendered movie poster showed a giant wall of text where the short "mood"
label should have been. Root cause: the Architect's `Blueprint.mood` field occasionally came
back containing the **entire mood-direction instruction block** (the model echoed its own
input context into the output field) instead of a short label like "Maximum Drama." Two-layer
fix:
1. **Schema-level guidance** (`schemas.py`): added a `Field(description=...)` on `Blueprint.mood`
   explicitly telling the model: "A SHORT mood/register label only — 2-4 words... Never a
   sentence and never the mood instructions." (Pydantic field descriptions get serialized into
   the JSON Schema sent to the model, so this directly informs generation, not just validation.)
2. **Defense in depth at the code level** (`pipeline.py: _clean_mood`): even with better
   guidance, nothing stops a model from occasionally ignoring it — so `_assemble_full()` runs
   the returned mood value through a guard that rejects anything empty, longer than 40
   characters, or multi-line, and **falls back to the user's originally selected mood label**
   instead. This is a good example of the general pattern in this codebase: **prompt
   improvements reduce the *frequency* of a problem; schema/code-level guards are what actually
   *prevent* it from reaching the user**, because you can never fully trust an LLM to honor an
   instruction 100% of the time.

---

## 8. Live streaming — why WebSocket, and the debugging story behind it

### 8.1 What gets streamed

The frontend's "Agent Thinking" panel shows each pipeline node as it completes, in real time
— `dispatch → architect → screenwriter → critic → (maybe loop back) → finalize` — using the
exact same `trace` entries each node appends to `ScriptState` (§4.3). There are two server
endpoints that both stream this:
- `POST /api/generate/stream` — Server-Sent Events. Kept for local development.
- `WS /api/generate/ws` — WebSocket. **What the deployed frontend actually uses.**

Both call `pipeline.stream(initial)`, a generator that wraps `GRAPH.stream(initial)`
(LangGraph's own incremental-execution API — it yields after each node finishes, not just at
the end) and re-yields `(node_name, partial_state)` pairs.

### 8.2 The bug, and why it needed a transport change, not a code fix

The original implementation only had the SSE endpoint. In production (Cloud Run + Firebase
Hosting), generation requests would start, the **server-side logs showed a clean 200 OK** for
the whole request, but the **browser never received any data until the very end** — and after
roughly a minute, it failed outright with "Stream failed (502)." This was confusing because
locally, over plain HTTP with no proxy in between, SSE streamed perfectly.

Root cause: **Cloud Run's ingress (and similar managed-proxy infrastructure) buffers long-lived
chunked HTTP responses.** SSE relies on the server flushing the TCP connection after every
small chunk and the proxy passing each chunk through immediately — but Cloud Run's ingress
was holding the entire response in a buffer and only releasing it at the end (or timing out and
502-ing if the request ran long, which a 5-7-call multi-agent generation routinely does, at
~80-90 seconds). No combination of `Cache-Control: no-cache, no-transform` / `X-Accel-Buffering:
no` / chunked transfer headers fixed this, because the buffering was happening at the
infrastructure layer Cloud Run controls, not in the application.

**The fix:** add a second endpoint, `/api/generate/ws`, using a **WebSocket** instead of
chunked HTTP. A WebSocket starts as a normal HTTP request but immediately upgrades to a raw,
full-duplex TCP-like pipe — Cloud Run's ingress treats it as an unbuffered byte stream, not as
"a slow HTTP response it should batch," so every frame sent by the server arrives at the
browser immediately. This is a transport-layer fix, not an application-logic fix — the
generator/streaming logic in `pipeline.stream()` didn't change at all; only how its events get
to the browser changed.

### 8.3 How the WebSocket endpoint is implemented (and why a worker thread)

`backend/app/main.py: generate_ws()`. The tricky part: `pipeline.stream()` is a **blocking
synchronous generator** (LangGraph's `.stream()` is sync; Gemini calls inside it block on
network I/O), but the WebSocket endpoint is `async def` and FastAPI's event loop must stay
responsive (to detect client disconnects, send keepalives, etc.) — if the blocking generator
ran directly on the event loop, the whole server would freeze for the ~80+ seconds of a
generation, breaking every other concurrent request too.

The bridge:
```python
loop = asyncio.get_running_loop()
queue: asyncio.Queue = asyncio.Queue()

def worker():                                    # runs in a separate OS thread
    def emit(evt):
        loop.call_soon_threadsafe(queue.put_nowait, evt)   # thread-safe handoff
    for node, partial in stream(initial):         # blocking call, but off the event loop
        ...
        emit({"type": "step", ...})
    emit({"type": "result", ...})
    emit(None)                                    # sentinel: tells the consumer we're done

task = asyncio.create_task(asyncio.to_thread(worker))
while True:
    evt = await queue.get()                       # the event loop just awaits the queue
    if evt is None: break
    await ws.send_text(_ws_json(evt))
```
`asyncio.to_thread(worker)` runs the entire blocking pipeline in a worker thread from a thread
pool. The worker can't safely call `await ws.send_text()` itself (that belongs to the event
loop's thread), so instead it calls `loop.call_soon_threadsafe(queue.put_nowait, evt)` — the
one safe way to hand data from a worker thread back into the event loop — and the async
`while` loop on the event loop side just drains that queue and forwards each event over the
socket. The event loop is never blocked by Gemini latency; it's purely doing cheap queue
reads and socket writes. `None` is used as a sentinel value to signal "the worker is done" since
it can't naturally fall off the end of an async generator the way a `for` loop would.

### 8.4 The debugging saga (good "tell me about a bug you chased" story)

Worth being able to narrate briefly: fixing this took several iterations because **multiple
unrelated problems were stacked on top of each other** and each had to be peeled off before the
next was visible:
1. The WebSocket code was committed and pushed, but `firebase deploy` was run **before**
   `npm run build`, so the live site kept serving an old, pre-WebSocket JS bundle. (Vite
   content-hashes filenames, e.g. `index-BqQ-ATdF.js` vs `index-g0XBGuuv.js`, which made the
   stale bundle obvious once checked.)
2. After fixing the build order, the live bundle still didn't match current source — a stale
   `dist/` and `.firebase/` cache directory needed a clean rebuild.
3. The frontend's `VITE_API_BASE` pointed at a Cloud Run URL whose **backend revision hadn't
   been redeployed yet**, so the WebSocket route returned 403/404 — the backend needed its own
   redeploy with the new endpoint.
4. Only after all three were fixed did Cloud Run logs show `WebSocket /api/generate/ws
   [accepted]` and the full per-agent trace streaming live.

The lesson (and a fine thing to say in an interview): **when a fix "isn't working" in a system
with multiple deployable parts and caches, verify each layer independently (what code is
committed → what's built → what's deployed → what's actually being served) instead of assuming
the most recent change is wrong.**

---

## 9. Observability

File: `backend/app/observability/logger.py`. Every Gemini call — including each repair
attempt — logs the full system prompt, full user prompt, raw response text, captured "thought"
summary, and latency, to `backend/logs/<date>.jsonl`, keyed by `request_id` + agent name. This
means any generation can be fully reconstructed after the fact: which agent ran, what it was
asked, what it said, how long it took, and whether/why a repair was needed. Each node also
appends to the in-request `trace[]` list that's returned in `meta` and used for the live UI —
so the same trace concept serves both "show the user what's happening right now" and "let a
developer debug what happened after the fact."

---

## 10. Error handling, end to end

The brief explicitly calls for "robust error handling," so it's worth being able to name every
layer:

| Layer | Failure mode | Handling |
|---|---|---|
| Gemini call | 429 / 5xx / transient network | Retry w/ backoff (≤5 attempts), rate-limit pre-throttle |
| Gemini call | Daily quota truly exhausted | `RateLimitExceeded` raised immediately (no point waiting) → API returns typed `429 rate_limit` |
| Model output | Malformed/invalid JSON | Tolerant parse → one structured repair re-ask → `AgentError` if still invalid → API returns typed `502 agent` |
| Model output | Schema-valid but semantically wrong (e.g. mood field abused) | Defense-in-depth code guard (`_clean_mood`) with a safe fallback — never surfaces to the user as an error at all |
| Pipeline | Critic loop never converges | Loop guard ships the best draft anyway (`converged: false` in meta) instead of failing the request |
| WebSocket | Client disconnects mid-generation | `WebSocketDisconnect` caught; worker thread is still `await`-ed so it's reaped cleanly, not orphaned |
| WebSocket | First frame isn't a valid `GenerateRequest` | Typed `{"type":"error","kind":"bad_request"}` sent back before closing |
| Frontend | Any of the above | `ApiError`/typed WS error events carry a `kind` (`rate_limit` / `agent` / `network` / `bad_request` / `server`) so the UI can show a tailored message instead of a generic failure |
| Server crash | Any uncaught exception in an endpoint | Caught by a last-resort `except Exception` → typed `500 server` — the process itself never goes down because of one bad request |

The unifying idea: **every error has a `kind`**, propagated all the way from the rate
limiter/Gemini client through the pipeline, through the API response shape, to the frontend's
error banner — so "what went wrong" is always classifiable, never just a raw stack trace shown
to a user.

---

## 11. Frontend architecture

`frontend/src/`:
- **`App.tsx`** — the only stateful component of real complexity. Holds `situation/mood/
  director/madness` (inputs), `status/steps/script/meta/error` (the in-flight generation), and
  `busy/activeId` (regeneration + history-selection bookkeeping). A tiny hand-rolled router at
  the top (`window.location.pathname.match(/^\/drama\/([^/]+)$/)`) sends shared-link visitors to
  a read-only `DramaView` instead of the full app — no router library needed for one route.
- **`api.ts`** — the only file that knows about HTTP/WebSocket wire format. `generateStream()`
  wraps the WebSocket protocol in a Promise-based callback API (`onStep/onResult/onError`) so
  `App.tsx` doesn't need to know it's a WebSocket at all — it could be swapped for SSE or
  long-polling without touching the component.
- **`hooks/useHistory.ts`** — the entire "local history" requirement: reads/writes a JSON array
  in `localStorage` under `deepshorts.history.v1`, capped at 30 entries, with `add/update/
  remove/clear`. `update()` exists specifically so a regeneration updates the *same* history
  entry in place rather than creating a duplicate.
- **`hooks/useOptions.ts` / `useHealth.ts` / `useTheme.ts`** — small focused hooks: dropdown
  data from `/api/options`, a periodic `/api/health` ping for the "API Ready/Offline" pill, and
  light/dark theme persistence.
- **`firebase.ts`** — Firestore integration, **lazy-loaded** (`import("firebase/app")` inside
  the function, not a top-level import) so the entire Firebase SDK is only fetched if/when a
  user actually clicks "Share" — and so the app runs fully without Firebase configured at all
  (`firebaseEnabled` is just `Boolean(apiKey && projectId)`; sharing degrades to a clear inline
  message instead of breaking anything else).
- **Components** are one-job presentational pieces (`SceneCard`, `CharacterCard`, `MoodSelector`,
  `DirectorSelector`, `AgentThinking`, `HistoryPanel`, `ErrorBanner`, `ShareButton`, `DramaView`)
  — `App.tsx` owns state, they own rendering.

### Regeneration, from a click

`onRegen(type, index)` in `App.tsx` → `regenerate()` in `api.ts` → `POST /api/regenerate` with
the **current full `script`** (not just an id — there's nowhere server-side to look an id up)
plus `{type, index}` and an optional free-text `note` ("make it angrier"). The backend maps
`type` to a graph mode (`_TARGET_TO_MODE` in `main.py`) and re-enters the graph at that single
regen node (§4.2). The response replaces just `script` in React state and patches the same
history entry — the rest of the UI doesn't need to know anything changed.

---

## 12. Sharing — Firestore, and the incident behind it

"Share Drama" (`ShareButton.tsx` + `firebase.ts`) writes the current `Script` object as a new
document in a Firestore `dramas` collection and returns its auto-generated id; the link is
`/drama/<id>`, handled client-side by the tiny router in `App.tsx` rendering `DramaView`
(a read-only render of the same `Script`, fetched by `getDrama(id)`).

**Real incident:** sharing appeared to hang forever ("Sharing…" never resolved). Diagnosis via
the Firestore REST API directly returned `PERMISSION_DENIED` / `Cloud Firestore API has not
been used in project ... SERVICE_DISABLED` — **the Firestore database itself had never been
created** in that Firebase project. `addDoc()` doesn't surface this as a clean error in that
state; the SDK queues the write for when connectivity "returns" (it doesn't, because there's no
database to connect to), so the promise simply never resolves — which is why it looked like an
infinite spinner rather than a failure. Fix: create the Firestore database in the Firebase
console and publish open rules scoped to the one collection (`allow read, create: if true` on
`/dramas/{id}` — no update/delete, no auth needed since these are meant to be public,
disposable share links, not user accounts).

**Why is the Firebase web config (`apiKey`, etc.) safely committed/public while the Gemini key
is not?** This is a common point of confusion worth being precise about: Firebase's *client*
API key is a **project identifier**, not a secret — it's compiled into every web/mobile app's
public bundle by design, and access control is enforced server-side by **Firestore Security
Rules**, not by hiding the key. The Gemini API key, by contrast, is a **billable credential**
tied directly to a Google Cloud account — anyone holding it can spend the owner's money/quota.
That's the actual secret, and it lives only in `backend/.env` (gitignored) locally and as a
Cloud Run environment variable in production — never in any committed file or frontend bundle.

---

## 13. Deployment

- **Frontend → Firebase Hosting** (static assets from `frontend/dist`, built by Vite).
  `npm run build` **must** run before `firebase deploy` — deploy only uploads whatever's
  currently sitting in `dist/`; it doesn't trigger a build itself.
- **Backend → Google Cloud Run**, built from the root `Dockerfile`, deployed
  `--allow-unauthenticated` (it's a public, stateless, cookie-free API — no session to protect)
  and `--max-instances 1` (§6 — keeps the in-memory rate limiter's accounting accurate).
- The browser calls the Cloud Run service URL **directly** (set via `VITE_API_BASE` at build
  time in `frontend/.env.production`) rather than through a Firebase Hosting rewrite proxy —
  an earlier attempt at routing through a Hosting rewrite was abandoned because it added another
  buffering proxy layer in front of the already-buffering Cloud Run ingress, compounding the
  streaming problem in §8 instead of solving it. Direct calls + WebSocket was the combination
  that actually worked.
- Full step-by-step (including the two failed streaming attempts, for context) lives in
  `docs/DEPLOY.md`.

---

## 14. Likely interview questions, answered short

**"Why LangGraph instead of just calling three functions in sequence in plain Python?"**
The control flow genuinely isn't linear — there's a conditional loop (critic → revise, bounded)
and multiple alternate entry points (4 regeneration modes) that share infrastructure (the same
`dispatch` setup, the same per-node tracing). LangGraph gives that for free: conditional edges,
a `.stream()` API that yields after every node (which is what powers live visualization, §8),
and a state-merge model that keeps each node's logic from needing to know how it got invoked.
Plain sequential function calls would've meant hand-rolling all of that.

**"Why not LangChain agents/tools?"**
There are no tools to call and no open-ended agentic reasoning needed — every step has a fixed,
known shape (architect always produces a Blueprint, etc.). LangChain's agent abstractions solve
a different problem (an LLM deciding *which* tool to call next); this system's structure is
already fully known at design time, so a state graph with deterministic routing is a better fit
than a tool-calling agent loop.

**"How would you scale this past one Cloud Run instance?"**
Move the rate limiter's state out of process memory into something shared (Redis token bucket,
or a Firestore/Cloud Memorystore-backed counter), then `--max-instances` can go above 1 safely.
Nothing else in the design assumes a single instance — `ScriptState` is already fully
request-local with no shared mutable state.

**"What was the hardest bug?"**
The WebSocket streaming saga (§8.4) — not because any single fix was hard, but because three
independent problems (build order, stale build cache, undeployed backend revision) were stacked
on top of the actual infra-buffering root cause, and each layer had to be verified independently
before the next one became visible.

**"How do you know the model won't just ignore your JSON schema?"**
You don't, fully — that's exactly why validation happens in code (Pydantic), not just in the
prompt. The mood-field bug (§7.4) is the concrete proof: better prompt wording reduced how often
it happened, but the actual fix that *guarantees* correctness is the code-level guard with a
safe fallback. The general principle followed throughout: **prompts steer; code guarantees.**

**"Why Gemini and not OpenAI/Claude?"**
Free tier availability for a take-home assignment with no budget, with `google-genai`'s native
SDK support for thinking-mode + structured-ish output. The architecture doesn't hard-depend on
Gemini specifics beyond the client wrapper — swapping providers would mean rewriting
`llm/client.py`'s `_raw_call`/`_split_parts`, not touching agents, schemas, or the graph.

---

## 15. File map (for quick navigation during a screen-share)

```
backend/app/
├── main.py                # FastAPI endpoints incl. the WebSocket bridge
├── config.py               # every tunable in one place (model, rate limits, paths)
├── schemas.py               # Pydantic contracts — the structured handoff backbone
├── prompts_loader.py        # compose_voice(): base + mood + director → shared context
├── agents.py                # the 3 agents + 4 regen agents; role prompts
├── llm/
│   ├── client.py            # THE choke point: rate-limit→think→retry→parse→validate→repair
│   └── rate_limiter.py      # token bucket (RPM) + daily counter (RPD)
├── graph/
│   ├── state.py             # ScriptState TypedDict
│   └── pipeline.py          # LangGraph nodes, routing, the critic loop, stream()
└── observability/logger.py  # full prompt/response/thought/latency logging

frontend/src/
├── App.tsx                  # state owner + tiny router (home vs /drama/:id)
├── api.ts                   # typed HTTP + WebSocket client
├── firebase.ts               # lazy Firestore for sharing
├── types.ts                  # mirrors backend Pydantic models
├── hooks/                    # useHistory, useOptions, useHealth, useTheme
└── components/                # one job each: presentational only

prompts/
├── script_generator.system.md   # base "world bible" + two slot markers
├── moods/*.md                    # 16 register blocks
└── directors/*.md                # 10 voice blocks
```

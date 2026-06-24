# `backend/app` — Line-by-Line Walkthrough

Every file in `backend/app`, explained line by line (or in tight logical groups where several
lines do one indivisible thing — e.g. a function signature + its return statement). Read in
this order: it follows the dependency chain (things with no imports from this project first,
things that import everything else last), which is also the order you'd want to explain the
system in out loud.

```
__init__.py files (empty)
  → config.py        (no internal deps — everyone imports this)
  → schemas.py        (no internal deps — the data contracts)
  → graph/state.py     (no internal deps — the state shape)
  → llm/rate_limiter.py (no internal deps — pure utility)
  → llm/client.py       (imports config, rate_limiter)
  → prompts_loader.py    (imports config)
  → agents.py             (imports client, schemas)
  → graph/pipeline.py      (imports agents, config, state, client, logger, prompts_loader, schemas)
  → observability/logger.py (imports config)
  → main.py                  (imports pipeline, client, rate_limiter, prompts_loader, schemas, config)
```

---

## Python syntax glossary (so it's not repeated 50 times below)

These constructs show up over and over across the files. Look them up here once; the
per-file sections below call out anything *not* on this list inline.

- **`"""..."""` triple-quoted string at the top of a file/function/class** — a **docstring**.
  Not a comment (comments are `#`); it's a real string object Python attaches to the module/
  function/class as `.__doc__`, which is why tools (and `help()`) can show it. Using it as the
  very first statement in a file documents the whole module's purpose.
- **`from __future__ import annotations`** — changes how type hints are stored: instead of
  being evaluated immediately when Python reads the function/class, they're kept as plain text
  and only evaluated if something explicitly asks for them. Lets you write hints like
  `str | None` or reference a class in its own method before the class is fully defined, without
  errors, and has zero effect on runtime behavior of the actual code.
- **Type hints in general** (`x: int`, `def f(x: str) -> bool:`) — these are **not enforced by
  Python itself** at runtime; they're documentation read by editors/type-checkers (and, for
  Pydantic models specifically, *also* used to build real runtime validation — see below).
  `Optional[str]` and `str | None` mean the same thing: "a string, or `None`."
  `list[str]` means "a list whose items are strings." `dict` with no brackets means "a dict of
  unspecified key/value types."
- **`class Foo(BaseModel):`** — inheritance: `Foo` *is a* `BaseModel` (from Pydantic) and gets
  all of its behavior for free (constructor that accepts keyword args matching the declared
  fields, `.model_dump()` to get a plain dict, `.model_dump_json()` for a JSON string,
  `.model_validate(data)` to build-and-check an instance from raw data, automatic `__init__`,
  automatic equality, etc.). You never write `__init__` yourself for these classes — Pydantic
  generates it from the field declarations.
- **`field: Type = default`** inside a Pydantic model body — declares a field. If you write
  `field: list = []`, that's actually dangerous in *plain* Python classes (a shared mutable
  default), but Pydantic special-cases this safely; even so, Pydantic models conventionally use
  `Field(default_factory=list)` to be explicit that each instance gets its **own** fresh list,
  not one shared list object.
- **`Field(...)`** — a function from Pydantic used in place of a plain default value when you
  need to attach metadata: `Field(min_length=1)` (validation rule), `Field(description="...")`
  (text fed into the JSON Schema — which, in this codebase, gets sent to the LLM as part of the
  "shape your output like this" instruction, so a `description` here is read by the model
  itself, not just by humans), `Field(ge=0, le=100)` (numeric bounds: greater-or-equal,
  less-or-equal), `Field(default_factory=list)` (call `list()` fresh for each instance).
- **`Literal["a", "b", "c"]`** — a type hint meaning "must be exactly one of these specific
  string values," not just "any string." Pydantic enforces this as a real runtime check.
- **`@decorator` above a function/class** — a decorator *wraps* the function/class right after
  it's defined, swapping it for a modified version. `@app.get("/api/health")` (FastAPI) replaces
  the function with one that's registered to handle that route. `@lru_cache(maxsize=64)`
  (standard library) replaces the function with a caching wrapper that remembers past
  return values for past arguments and returns them instantly on a repeat call instead of
  re-running the function body.
- **`def f(*args, **kwargs)` / calling `f(**some_dict)`** — `*` collects/spreads *positional*
  arguments into/from a tuple; `**` collects/spreads *keyword* arguments into/from a dict.
  `def log_event(request_id, agent, event, **data)` means "accept any extra keyword arguments
  the caller passes, and gather them into a dict named `data`." Calling `f(**rec)` means "unpack
  this dict and pass each key as a separate keyword argument."
- **`{**a, **b}`** (dict literal with `**` inside) — merges dicts into a new one; keys from `b`
  override keys from `a` if they collide. `{**meta, "title": x}` means "everything in `meta`,
  plus (or overriding) a `title` key."
- **f-strings**, `f"text {expr}"` — string interpolation; whatever's inside `{}` is evaluated
  and converted to a string and inserted in place.
- **List/dict comprehensions**, `[x for x in items if cond]` — build a new list (or dict, with
  `{k: v for ...}`) by iterating `items`, optionally filtering with `if`. It's a compact `for`
  loop that produces a collection instead of needing you to `.append()` manually.
- **Generators and `yield`** — a function containing `yield` doesn't run its body when called;
  it returns a *generator object* that runs the body incrementally, pausing at each `yield` and
  resuming on the next `next()` (which a `for` loop does automatically). This is how
  `pipeline.stream()` produces results node-by-node, in real time, instead of computing
  everything and returning it all at once.
- **`async def`, `await`** — marks a function as a *coroutine*: calling it doesn't run it
  immediately, it returns an awaitable that must be `await`-ed to actually run and get a result.
  `await` pauses the current coroutine (without blocking the whole program/thread) until
  whatever's being awaited finishes — typically I/O (a socket read, a queue pop). This is what
  lets one Python process handle many WebSocket connections "at once" without one thread per
  connection.
- **`with open(...) as f:` / `with lock:`** — a **context manager**: guarantees cleanup
  (closing the file, releasing the lock) happens even if an exception is raised inside the
  block, without needing an explicit `try/finally`.
- **`try / except SomeError as exc: / raise`** — standard exception handling; `as exc` binds the
  caught exception object to a name so you can inspect/log/re-raise it. A bare `raise` inside an
  `except` re-raises the same exception; `raise NewError(...) from exc` raises a *different*
  exception while keeping the original attached as `.__cause__` (so tracebacks show both).
- **`TypedDict`** (from `typing`) — describes the *shape* of a plain `dict` (which keys, which
  value types) without making it a real class with its own methods — it's still just a `dict` at
  runtime, the type hints are for clarity/tooling only. `total=False` means none of the declared
  keys are required to be present.
- **`TypeVar`, `Type[T]`, generics** — `T = TypeVar("T", bound=BaseModel)` declares a
  placeholder type "some specific subclass of BaseModel, to be determined by the caller."
  `Type[T]` means "the *class itself*, not an instance of it" (e.g. passing `Blueprint` the
  class, not a `Blueprint()` instance) — this is how `generate_json(..., schema: Type[T]) -> T`
  can be reused for any Pydantic schema while still being type-correct for each specific call.

---

## 0. The `__init__.py` files

`backend/app/__init__.py`, `backend/app/llm/__init__.py`, `backend/app/graph/__init__.py`,
`backend/app/observability/__init__.py` — **all four are empty.** They exist purely so Python
treats `app/`, `app/llm/`, `app/graph/`, `app/observability/` as **packages** (importable as
`app.config`, `app.llm.client`, `app.graph.pipeline`, `app.observability.logger`). An empty
`__init__.py` is a deliberate no-op — there's no shared package-level state or re-exports
needed here, so adding anything to them would just be unused code.

---

## 1. `backend/app/config.py` — every tunable, in one file

```python
"""Central configuration, loaded from environment / .env.

Every tunable that affects rate-limit safety, resilience, or prompt location lives
here so the whole system can be reasoned about from one file.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
```
- The module docstring states the design intent directly: this file is the **single source of
  truth for tunables** — if you're ever asked "where would I change X," the answer for rate
  limits, the model name, retry counts, or prompt file locations is always "config.py."
- `from __future__ import annotations` — makes all type hints in the file lazily-evaluated
  strings under the hood (PEP 563). Lets you write modern hint syntax (like `Path | None`)
  without worrying about Python version support for that exact syntax at runtime, and avoids
  a class needing to already be defined above the point it's referenced in a hint.
- `Path` — used below for filesystem paths (`prompts/`, `logs/`, `directors/`), instead of raw
  strings, so path-joining (`/`) and existence checks (`.exists()`) are first-class.
- `BaseSettings, SettingsConfigDict` from `pydantic_settings` — this is what turns a plain class
  into a settings object that auto-populates its fields from environment variables / a `.env`
  file, with type coercion and validation for free (e.g. `rpm_limit: int` will fail loudly if
  the env var isn't a valid int, rather than silently being a string).

```python
_BACKEND_DIR = Path(__file__).resolve().parents[1]   # backend/
_REPO_ROOT = _BACKEND_DIR.parent                      # repo root (holds prompts/)
```
- `Path(__file__)` is the path to *this file* (`config.py`), `.resolve()` makes it absolute,
  `.parents[1]` walks up two directories: `config.py` → `app/` (parents[0]) → `backend/`
  (parents[1]). So `_BACKEND_DIR` is always `backend/`, computed relative to where this source
  file lives — **not** relative to whatever directory the process happens to be launched from.
  This is why `uvicorn app.main:app` works correctly regardless of your current shell directory.
- `_REPO_ROOT` is one level above `backend/` — the repo root, which is where `prompts/` (the
  mood/director library, shared with no other backend concept) actually lives, since prompts
  aren't backend-specific content.

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
```
- Declares the settings class. `model_config` is Pydantic v2's way of configuring model
  behavior (replaces the old inner `class Config:`).
- `env_file=str(_BACKEND_DIR / ".env")` — tells pydantic-settings to look for `.env`
  specifically inside `backend/`, computed from `_BACKEND_DIR` above (again: absolute, not
  cwd-relative — so it finds the file no matter where you run uvicorn from).
- `extra="ignore"` — if `.env` has keys that don't map to any field below (e.g. a leftover var
  from an old experiment), don't raise an error; just ignore them. Without this, Pydantic's
  default is stricter and would crash startup on an unrecognized key.

```python
    # --- Gemini ---
    gemini_api_key: str = ""
    # gemini-2.5-flash: established model with the full free-tier allowance (15 RPM /
    # 1500 RPD). The newer gemini-3.5-flash launched with a far smaller free daily cap
    # (~20/day), which throttled generation, so we default to 2.5-flash. Override via
    # the GEMINI_MODEL env var if you want a different model.
    gemini_model: str = "gemini-2.5-flash"
```
- `gemini_api_key: str = ""` — defaults to empty string (not `None`), so the rest of the code
  can always safely treat it as a string (e.g. `bool(settings.gemini_api_key)` in the health
  endpoint) without a `None`-check. In practice this is always overridden by the real key from
  `.env` (locally) or a Cloud Run env var (in production); it's never committed.
- `gemini_model` — the field name is automatically mapped from the env var `GEMINI_MODEL`
  (pydantic-settings does case-insensitive snake_case ↔ UPPER_SNAKE matching by default). The
  comment captures the real production incident: this default was changed from
  `gemini-3.5-flash` after discovering its free daily quota (~20 requests/day) was far too small
  for a multi-call-per-generation pipeline, vs. `2.5-flash`'s 1500/day.

```python
    # --- Orchestration ---
    max_iterations: int = 2          # critic -> revise loop ceiling (loop guard)
    enable_thinking: bool = True
    temperature: float = 1.0
```
- `max_iterations: int = 2` — the loop guard referenced throughout the pipeline: the
  critic→screenwriter revision loop can fire at most twice before `finalize` is forced
  regardless of whether the critic actually passed the script. This bounds worst-case latency
  and request count.
- `enable_thinking: bool = True` — turns on Gemini's "thinking" mode (extended reasoning,
  captured separately from the answer) by default; the Gemini client can still turn it off
  per-call if the SDK/model rejects it (see `client.py`).
- `temperature: float = 1.0` — sampling temperature passed to every Gemini call. `1.0` favors
  more creative/varied output, fitting a "dramatic, over-the-top movie generator" — a lower
  temperature (more deterministic) would work against the product's whole pitch.

```python
    # --- Rate limiting / resilience (free tier: 15 RPM, 1500 RPD) ---
    rpm_limit: int = 12
    rpd_limit: int = 1400
    max_retries: int = 5
    request_timeout_s: int = 120
```
- `rpm_limit: int = 12` and `rpd_limit: int = 1400` — deliberately **below** the real free-tier
  ceilings (15 RPM / 1500 RPD), so the in-process rate limiter (`rate_limiter.py`) throttles the
  app before Gemini itself would ever return a 429 — self-imposed margin, not the actual quota.
- `max_retries: int = 5` — how many attempts the Gemini client makes for a single logical call
  before giving up on transient errors (429/5xx/timeouts).
- `request_timeout_s: int = 120` — declared here as a documented tunable, though note it isn't
  actually wired into an explicit per-call timeout anywhere in `client.py`'s `_raw_call` (the
  SDK call relies on its own internal defaults / the retry loop's own backoff timing). It's
  present for future use and for documentation of intent.

```python
    # --- Paths ---
    prompts_dir: Path = _REPO_ROOT / "prompts"
    log_dir: Path = _BACKEND_DIR / "logs"
    director_images_dir: Path = _REPO_ROOT / "directors"   # <id>.jpg photos for the UI
```
- `prompts_dir` — where `prompts_loader.py` looks for the base prompt and the mood/director
  library files; rooted at the repo root, not inside `backend/`, since prompts are shared
  content, not backend-internal.
- `log_dir` — where `observability/logger.py` writes daily `.jsonl` log files; rooted inside
  `backend/` since logs are a backend runtime artifact.
- `director_images_dir` — a top-level `directors/` folder (sibling to `backend/`/`frontend/`)
  holding `<director-id>.jpg` photos that `main.py` serves as static files for the director
  picker UI.

```python
    # --- CORS ---
    # "*" is fine here: this is a public, unauthenticated, cookie-free API (no user
    # sessions to leak cross-origin). The frontend now calls Cloud Run directly
    # (not through a Firebase Hosting rewrite — see docs/DEPLOY.md), so cross-origin
    # browser requests are the normal case in production, not an edge case.
    cors_origins: list[str] = ["*"]


settings = Settings()
```
- `cors_origins: list[str] = ["*"]` — allows requests from any origin. The comment justifies why
  this is safe *here specifically*: there are no cookies/sessions for a malicious site to ride
  along with (no CSRF surface), and every request is a self-contained JSON payload the caller
  fully controls anyway (there's no "your account's data" to steal cross-origin).
- `settings = Settings()` — **module-level instantiation**. This is the actual moment env vars
  / `.env` get read and validated — it happens once, at import time, and the resulting singleton
  `settings` object is what every other file in the codebase imports (`from app.config import
  settings`) instead of constructing their own `Settings()`.

---

## 2. `backend/app/schemas.py` — the structured contracts

```python
"""Pydantic models = the structured contract every agent hands off and the API returns.

Structured handoffs are validated at every boundary; nothing passes freeform prose to
the next agent. This is the single most important defense against silent breakage in a
multi-agent pipeline.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field
```
- `Literal, Optional` from `typing` — see glossary. `BaseModel, Field` from `pydantic` — the
  two building blocks used for every model in this file.

```python
# ---------- core story objects ----------
class Character(BaseModel):
    name: str
    role: str
    description: str
    # internal craft fields (used by the screenwriter; harmless in the UI cards)
    want: Optional[str] = None
    fear: Optional[str] = None
    contradiction: Optional[str] = None
```
- `name/role/description: str` — required fields (no default given → Pydantic raises a
  validation error if missing from the input).
- `want/fear/contradiction: Optional[str] = None` — optional; the Architect fills these in to
  give the Screenwriter psychological depth to write from, but the comment notes the UI's
  character cards don't need to display them — they're "harmless" if present, just unused by
  that one consumer. This is a good example of one schema serving two different downstream
  uses (an internal writing aid *and* a public-facing display object) without needing two
  separate types.

```python
class SceneBeat(BaseModel):
    """One line in the Architect's escalation plan (not yet a written scene)."""
    scene_index: int
    intent: str                                  # what happens / what turns
    heading: Optional[str] = None                # INT./EXT. LOCATION - TIME
    characters: list[str] = Field(default_factory=list)
    escalation: Optional[str] = None             # how it's bigger than the previous beat
```
- This is the Architect's **plan** unit — deliberately thinner than a full `Scene` (no
  dialogue, no full description) because at this stage nothing has been *written* yet, only
  *planned*. Separating "the plan" (`SceneBeat`) from "the written scene" (`Scene`, below) as
  two distinct types is what makes the Architect → Screenwriter handoff a real contract instead
  of the Screenwriter having to guess what's expected of it.
- `characters: list[str] = Field(default_factory=list)` — see glossary: each `SceneBeat`
  instance gets its own independent empty list by default, not one list object shared by
  accident across instances.

```python
class Blueprint(BaseModel):
    """Architect output: the whole film designed, before any scene is written."""
    movie_title: str
    tagline: str
    logline: str
    mood: str = Field(
        description="A SHORT mood/register label only — 2-4 words, e.g. 'Maximum Drama', "
        "'Noir Thriller', 'Comedy Chaos'. Never a sentence and never the mood instructions."
    )
    characters: list[Character]
    scene_plan: list[SceneBeat] = Field(min_length=1)
```
- `Blueprint` is the Architect's full structured output — everything needed to write the film
  except the actual scene prose.
- `mood: str = Field(description=...)` — note there's **no explicit default value** here even
  though `Field(...)` is being used; the field is still required (Pydantic requires a value
  unless you also pass `default=...`). The `description` text is purely metadata that ends up
  in `schema.model_json_schema()` — and because `generate_json()` in `client.py` sends that
  schema *to the model*, this description is effectively a targeted instruction the model reads
  for this one field, on top of (and reinforcing) whatever the prompt text says elsewhere.
  This was added specifically to fix a real bug — see §7.4 in `INTERVIEW_PREP.md`.
- `characters: list[Character]` — a list of *nested* Pydantic models. Pydantic validates each
  item recursively: if any character dict in the model's raw output is missing a required
  field, validation fails on the whole `Blueprint`, not silently on just that character.
- `scene_plan: list[SceneBeat] = Field(min_length=1)` — must contain at least one beat; an empty
  plan is rejected by validation rather than silently producing a zero-scene film.

```python
class DialogueLine(BaseModel):
    character: str
    delivery: str = ""                           # parenthetical: tone / staging
    line: str = Field(
        description="Natural Hinglish (Hindi-led, Roman script) with English only for "
        "modern/technical words. Never plain English."
    )
```
- `delivery: str = ""` — defaults to an empty string (not `None`) since it's rendered directly
  in the UI as an optional parenthetical (e.g. "(quiet, not looking up)") — an empty string
  renders as nothing, with no `None`-check needed on the frontend.
- `line: str = Field(description=...)` — same pattern as `Blueprint.mood`: the Hinglish-only
  rule is restated here, as a `description`, specifically because this is the field most
  directly responsible for the product's defining stylistic requirement, and it's cheap
  insurance to state it again at the exact field the model is filling in, not just once in the
  system prompt.

```python
class Scene(BaseModel):
    scene_index: int
    scene_title: Optional[str] = None
    heading: str
    scene_description: str = Field(description="In clear English: what happens and how it's staged.")
    dialogue: list[DialogueLine] = Field(min_length=1)


class ScenesOut(BaseModel):
    scenes: list[Scene] = Field(min_length=1)


class DialogueOut(BaseModel):
    """Output of the dialogue-only regeneration."""
    dialogue: list[DialogueLine] = Field(min_length=1)


class CharactersOut(BaseModel):
    characters: list[Character] = Field(min_length=1)


class MetaOut(BaseModel):
    """Output of the title/tagline/logline regeneration."""
    movie_title: str
    tagline: str
    logline: str = ""
```
- `Scene` is a fully written scene — the Screenwriter's per-scene output unit.
- `ScenesOut`, `DialogueOut`, `CharactersOut`, `MetaOut` are all **wrapper models that exist for
  one reason**: `client.generate_json()` always asks the model for "a single JSON object," so
  any agent whose natural output is a *list* (all scenes; just the dialogue lines; just the
  characters) needs a wrapper object with that list as a named field (`{"scenes": [...]}`,
  `{"dialogue": [...]}`, `{"characters": [...]}`) instead of a bare JSON array at the top level.
  This is a real, deliberate design pattern, not incidental — it keeps the "always one JSON
  object" contract uniform across every single agent call in the codebase, including the ones
  whose conceptual output is "a list of things."

```python
class Issue(BaseModel):
    scene_index: Optional[int] = None
    problem: str
    fix: str


class Critique(BaseModel):
    passed: bool
    score: int = Field(ge=0, le=100)
    issues: list[Issue] = Field(default_factory=list)
    note: str = ""
```
- `Issue.scene_index: Optional[int] = None` — optional because some issues are about the script
  as a whole (e.g. "the ending doesn't land") rather than one specific scene.
- `Critique.score: int = Field(ge=0, le=100)` — `ge`/`le` = "greater-or-equal"/"less-or-equal";
  Pydantic will reject a score of `150` or `-3` outright as a validation failure, which (via the
  client's one-repair-then-fail mechanism) gives the model one chance to self-correct an
  out-of-range score before the whole critic call is treated as a failure.
- `issues: list[Issue] = Field(default_factory=list)` — defaults to an empty list (a passing
  script legitimately has zero issues), each `Critique` instance getting its own list.

```python
class Script(BaseModel):
    """The full assembled film returned to the client and stored in history."""
    movie_title: str
    tagline: str
    mood: str
    logline: str = ""
    directed_in_the_style_of: str = "—"
    characters: list[Character]
    scenes: list[Scene] = Field(min_length=1)
```
- `Script` is the **final, public-facing shape** — what the API actually returns and what
  the frontend stores in `localStorage` history. Notice it's a *different* type from
  `Blueprint`: `Blueprint` has `scene_plan: list[SceneBeat]` (intent/escalation notes, no
  dialogue); `Script` has `scenes: list[Scene]` (fully written, with dialogue). `pipeline.py`'s
  `_assemble_full()` is the function that actually builds a `Script` out of a `Blueprint` +
  a list of `Scene`s — the type system enforcing that you can't accidentally hand the frontend
  an unwritten plan instead of a finished script.
- `directed_in_the_style_of: str = "—"` — defaults to an em dash, which is what's shown when no
  director was selected (`prompts_loader.pretty(None)` also returns `"—"` — the same "no
  selection" placeholder is used consistently end-to-end).

```python
# ---------- API request / response ----------
class GenerateRequest(BaseModel):
    situation: str = ""
    mood: Optional[str] = None                   # mood id (filename in prompts/moods)
    director: Optional[str] = None               # director id (filename in prompts/directors)
    characters_hint: Optional[str] = None
```
- This is the **wire format** the frontend POSTs (or sends over the WebSocket as the first
  frame) — FastAPI uses this type to auto-validate incoming request bodies and auto-generate
  the OpenAPI docs at `/docs`.
- `mood`/`director` are **ids** (filenames without `.md`, e.g. `"corporate-war"`), not display
  labels — the mapping from id to a pretty label (`"Corporate War"`) happens separately in
  `prompts_loader.pretty()`.

```python
class RegenTarget(BaseModel):
    # "dialogue" = rewrite only the dialogue of a scene; "scene" = rewrite the whole scene.
    type: Literal["title", "tagline", "meta", "scene", "dialogue", "characters"]
    index: Optional[int] = None                  # scene_index for scene/dialogue targets


class RegenerateRequest(BaseModel):
    script: Script                               # canon round-tripped from the client (history)
    target: RegenTarget
    mood: Optional[str] = None
    director: Optional[str] = None
    note: Optional[str] = None                   # optional user steer ("make it angrier")
```
- `RegenTarget.type: Literal[...]` — restricts the field to exactly those six strings; any other
  value fails FastAPI's request validation automatically, before the endpoint code even runs
  (this is why `main.py`'s `_TARGET_TO_MODE.get(req.target.type)` returning `None` is treated as
  unreachable-but-defensive rather than the primary validation — Pydantic already filtered out
  garbage `type` values).
- `RegenerateRequest.script: Script` — this is the field that **is** the "no server-side
  database" design: the entire current script gets sent back on every regeneration request,
  because the server has nowhere to look up "the script the user was last working on" itself.

```python
class GenerateResponse(BaseModel):
    ok: bool = True
    script: Script
    meta: dict = Field(default_factory=dict)     # request_id, converged, score, iterations,
    #                                              situation/mood/director echoes, trace[]
```
- `meta: dict` — deliberately **untyped** (just `dict`, not a specific Pydantic model) even
  though everything else in this file is strictly typed. This is a conscious looseness: `meta`'s
  shape varies slightly between a full generation and a regeneration (different keys are
  meaningful), and it's purely informational/debugging payload for the frontend (trace
  steps, scores, echoes of the inputs) rather than something downstream code needs to validate
  and trust the structure of the way it trusts `script`. Typing it strictly would add ceremony
  without adding real safety here.

---

## 3. `backend/app/graph/state.py` — the one object every node shares

```python
"""The graph state — one object threaded through every node.

Regeneration is solved WITHOUT any server-side persistence: the client round-trips the
full Script (from its localStorage history) back to us as `canon_script`, and the graph
initializes a fresh state from it. So 'state' is per-request and self-contained; the only
durable memory is the browser's history, exactly as the assignment specifies.
"""
from __future__ import annotations

from typing import Optional, TypedDict


class ScriptState(TypedDict, total=False):
    # identity / routing
    request_id: str
    mode: str                       # full | regen_scene | regen_dialogue | regen_meta | regen_characters

    # inputs
    situation: str
    mood: Optional[str]
    director: Optional[str]
    characters_hint: Optional[str]
    note: Optional[str]
    voice_system: str               # composed base + mood + director context

    # full-generation working memory
    blueprint: dict                 # Blueprint
    scenes: list                    # list[Scene dict]
    critique: dict                  # Critique
    iteration: int                  # number of screenwriter passes (loop guard)
    converged: bool

    # regeneration working memory
    canon_script: dict              # existing Script round-tripped from the client
    target_index: Optional[int]

    # output + observability
    script: dict                    # final Script
    trace: list                     # [{step, status, detail, ...}] for agent visualization
    errors: list
```
- `class ScriptState(TypedDict, total=False):` — see glossary: this is **not** a real class with
  behavior; at runtime a `ScriptState` is literally just a plain Python `dict`. The `TypedDict`
  declaration exists purely so editors/type-checkers (and a human reading the file) know which
  keys are expected and what type each one's value should be — LangGraph itself doesn't care
  about this declaration at all; it just merges whatever plain dicts the nodes return.
- `total=False` — without this, a `TypedDict` would (by type-checking convention) expect *every*
  declared key to be present in every instance. `total=False` says "every key is optional" —
  correct here because, e.g., `blueprint`/`scenes`/`critique` simply don't exist yet in the
  state before the `architect`/`screenwriter`/`critic` nodes have run, and `canon_script`/
  `target_index` only exist on the regeneration branch, never on a full generation.
  `state.get("trace", [])` patterns throughout `pipeline.py` exist specifically because of this
  — any key might genuinely be absent.
- The keys are grouped by comments into **four life-cycle phases**: identity/routing (decided
  once, by `dispatch`), inputs (provided by the client, fixed for the whole request), working
  memory (built up incrementally as nodes run — different subsets populated depending on
  whether this is a full generation or a regeneration), and output/observability (what the
  caller actually reads back). This grouping mirrors how a request's data actually flows through
  time, not alphabetical or some other arbitrary order.
- `blueprint: dict`, `scenes: list`, `critique: dict`, `script: dict`, `canon_script: dict` —
  these are all stored as **plain dicts**, not as the actual `Blueprint`/`Scene`/`Critique`/
  `Script` Pydantic objects, even though those Pydantic types exist and are used elsewhere. This
  is because LangGraph's state needs to be a plain serializable structure it can merge/diff
  (Pydantic objects aren't naturally mergeable the way dicts are), so every node does
  `thing.model_dump()` before putting it in state, and `Thing.model_validate(state["thing"])`
  when reading it back out — you'll see this exact round-trip pattern repeatedly in
  `pipeline.py`.

---

## 4. `backend/app/llm/rate_limiter.py` — token bucket + daily cap

```python
"""Thread-safe token-bucket rate limiter + daily cap.

Rate limits are the real constraint on a free-tier multi-agent system, not scale. This
guards the per-minute budget (token bucket) and the per-day budget (counter), so we
throttle ourselves *before* Gemini returns 429s.
"""
from __future__ import annotations

import threading
import time


class RateLimitExceeded(Exception):
    """Raised when the per-day cap is hit (no point waiting — fail fast and clearly)."""
```
- `import threading` — used for `threading.Lock()` below, to make this class safe to call
  concurrently from multiple threads (relevant because the WebSocket handler in `main.py` runs
  the whole pipeline in a worker thread via `asyncio.to_thread`, and in principle multiple
  requests could be in flight at once, each from its own thread, all sharing the same
  `RateLimiter` instance since it's constructed once per `GeminiClient` singleton).
- `import time` — `time.monotonic()` (a clock that only ever moves forward, immune to system
  clock adjustments — correct for measuring *elapsed* time) and `time.strftime()` (formats the
  *wall-clock* date, needed because "is it a new calendar day yet" is inherently a wall-clock
  question, not an elapsed-time one).
- `class RateLimitExceeded(Exception):` — a custom exception type, used instead of a generic
  `Exception` so calling code can specifically catch *this* failure mode (`except
  RateLimitExceeded:` appears in `main.py` and `pipeline.py`) and respond with a `429` rather
  than treating it the same as any other unexpected error.

```python
class RateLimiter:
    def __init__(self, rpm: int, rpd: int):
        self.capacity = float(rpm)
        self.tokens = float(rpm)
        self.refill_per_sec = rpm / 60.0
        self.updated = time.monotonic()

        self.rpd = rpd
        self.day = time.strftime("%Y-%m-%d")
        self.day_count = 0

        self.lock = threading.Lock()
```
- `self.capacity = float(rpm)` — the bucket's maximum size: it can never hold more than `rpm`
  tokens worth of "burst" allowance, even if it's been refilling for a long time unused.
- `self.tokens = float(rpm)` — **starts full**: on process startup, you get to spend up to a
  full minute's worth of requests immediately, rather than waiting for the bucket to fill from
  zero. Reasonable since the process *just* started and hasn't used any quota yet.
- `self.refill_per_sec = rpm / 60.0` — converts "N requests per minute" into "N/60 fractional
  tokens added per second," which is what makes this a smooth **continuous** refill (e.g. half a
  token after 30 seconds) rather than a chunky "refill 12 tokens once a minute" scheme.
- `self.updated = time.monotonic()` — timestamp of the last time the token count was
  recalculated; needed because tokens are computed *lazily* — refilled only when `acquire()` is
  next called, by checking how much time has passed since `updated`, rather than running a
  background timer/thread to top up the bucket continuously.
- `self.day = time.strftime("%Y-%m-%d")` / `self.day_count = 0` — today's date string and how
  many requests have been spent today; `day_count` resets whenever `day` no longer matches
  today's actual date (checked inside `acquire()`).
- `self.lock = threading.Lock()` — a mutex: only one thread at a time can be inside a `with
  self.lock:` block, which is what makes the read-check-modify sequence on `tokens`/`day_count`
  atomic across threads (without it, two threads could both read "1 token left," both decide
  they're allowed to proceed, and both consume it — a classic race condition that would let the
  limiter under-count and exceed the real limit).

```python
    def acquire(self) -> None:
        """Block until a request token is available; raise if the daily cap is reached."""
        while True:
            with self.lock:
                today = time.strftime("%Y-%m-%d")
                if today != self.day:                 # new day -> reset daily counter
                    self.day, self.day_count = today, 0
                if self.day_count >= self.rpd:
                    raise RateLimitExceeded(
                        f"Daily request cap reached ({self.rpd}). Try again tomorrow or upgrade tier."
                    )
```
- `while True:` — this method either returns (token acquired) or raises (daily cap hit); it
  never "returns false," so the loop's only job is to repeatedly retry "is a token available
  *yet*" until one is, sleeping in between (see below) — there's no other way out of the loop
  except those two outcomes.
- `with self.lock:` — every read/write of shared state (`day`, `day_count`, `tokens`, `updated`)
  happens inside this lock. Note the **scope is small and re-acquired each loop iteration** —
  the lock is *not* held during the `time.sleep()` later in the function (deliberately: holding
  a lock while sleeping would block every other thread from even checking their own status, for
  no benefit — see the comment on that line below).
- `today != self.day` — string equality comparison of two `"YYYY-MM-DD"` strings; comparing
  formatted date strings instead of calendar/date objects is intentionally simple here — exactly
  good enough for "has the calendar day rolled over," nothing more is needed.
- `self.day, self.day_count = today, 0` — tuple assignment: both variables are updated together
  in one statement (assigns `today` to `self.day` and `0` to `self.day_count` simultaneously).
- `if self.day_count >= self.rpd: raise RateLimitExceeded(...)` — fails **immediately**, inside
  the lock, before even looking at the per-minute token bucket — there's no reason to check "is
  there a per-minute token available" if the whole day's budget is already spent; that token, if
  one were available, still couldn't legally be used.

```python
                now = time.monotonic()
                self.tokens = min(
                    self.capacity, self.tokens + (now - self.updated) * self.refill_per_sec
                )
                self.updated = now

                if self.tokens >= 1.0:
                    self.tokens -= 1.0
                    self.day_count += 1
                    return
                wait = (1.0 - self.tokens) / self.refill_per_sec

            time.sleep(min(wait, 5.0))                 # sleep outside the lock, then retry
```
- `(now - self.updated) * self.refill_per_sec` — "how many seconds since we last recalculated"
  times "tokens earned per second" = tokens earned since then. This is the lazy-refill
  calculation: rather than a background thread adding tokens every tick, the bucket is topped up
  in one computation, exactly once, right when something actually needs to know the current
  count.
- `min(self.capacity, ...)` — caps the refill at the bucket's max size, so unused capacity from
  a long idle period doesn't accumulate into an unbounded burst allowance.
- `self.updated = now` — resets the "last recalculated at" timestamp, so the *next* call's
  refill calculation only counts time elapsed since *this* moment, not double-counting.
- `if self.tokens >= 1.0: ... return` — the success path: spend one token, count it against
  today's total, and `return` — exiting the function (and implicitly releasing the lock via the
  `with` block ending) having let the caller proceed.
- `wait = (1.0 - self.tokens) / self.refill_per_sec` — only computed on the failure path: "how
  many more seconds until we'd have a full token," algebraically inverting the refill rate
  (tokens needed ÷ tokens-per-second = seconds needed).
- The `with self.lock:` block **ends** right after computing `wait` (indentation drops back one
  level for `time.sleep(...)`) — this is the deliberate "release the lock, *then* sleep" ordering
  the inline comment calls out: sleeping is slow and shouldn't block other threads from doing
  their own bucket math while this one thread is waiting.
- `time.sleep(min(wait, 5.0))` — sleeps for the computed wait, but **never more than 5 seconds**
  at a stretch, even if the real wait is longer — so the loop wakes up periodically and
  re-evaluates from scratch (re-checking the date rollover and the cap, not just blindly sleeping
  the full computed duration and hoping nothing changed) rather than committing to one long
  uninterruptible sleep.
- After the sleep, control flows back to `while True:` and the whole check repeats — this is the
  retry.

---

## 5. `backend/app/llm/client.py` — the single choke point

```python
"""Gemini client wrapper — the single choke point for every model call.
...
"""
from __future__ import annotations

import json
import random
import re
import time
from typing import Type, TypeVar

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import settings
from app.llm.rate_limiter import RateLimiter
from app.observability.logger import log_event

T = TypeVar("T", bound=BaseModel)

_THINK_TAG = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE = re.compile(r"^```(?:json)?|```$", re.MULTILINE)
```
- `import json` — `json.dumps`/`json.loads` for converting between Python dicts and JSON text.
- `import random` — `random.random()` below, for jitter in the retry backoff (explained there).
- `import re` — Python's regular-expression module; `re.compile(...)` pre-compiles a pattern
  into a reusable object (faster than re-compiling the same pattern string on every call, and
  this pattern *is* used on every single LLM response).
- `from google import genai` / `from google.genai import types` — the official Gemini SDK:
  `genai.Client` is the actual API client; `types.GenerateContentConfig` / `types.ThinkingConfig`
  are typed config objects the SDK expects.
- `from pydantic import BaseModel, ValidationError` — `ValidationError` is the specific
  exception Pydantic raises when `.model_validate()` fails; caught specifically (not just
  `Exception`) so only *schema* failures trigger the repair flow, not unrelated bugs.
- `T = TypeVar("T", bound=BaseModel)` — see glossary: declares a generic placeholder type,
  constrained to "must be a BaseModel subclass." This single line is what lets
  `generate_json(..., schema: Type[Blueprint]) -> Blueprint` and `generate_json(..., schema:
  Type[Critique]) -> Critique` both type-check correctly through the *same* method definition,
  instead of writing a separate method per schema.
- `_THINK_TAG = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)` — matches a
  `<think>...</think>` block (some models/configs emit reasoning wrapped in literal tags inside
  the answer text itself, separate from the SDK's own `thought` parts mechanism). `.*?` is a
  **non-greedy** match — stops at the *first* `</think>` rather than the last, so two separate
  think-blocks in one response don't get incorrectly merged into one giant match.
  `re.DOTALL` makes `.` match newlines too (a think block is usually multi-line).
  `re.IGNORECASE` tolerates `<THINK>`/`<Think>` etc.
- `_FENCE = re.compile(r"^```(?:json)?|```$", re.MULTILINE)` — matches a Markdown code-fence
  line: either an opening fence (optionally tagged ```` ```json ````) at the start of a line, or
  a closing ` ``` ` at the end of a line. `(?:json)?` is a **non-capturing optional group** —
  matches "json" if present but doesn't bother capturing it as a group since the code never
  needs that text, only needs to strip it. `re.MULTILINE` makes `^`/`$` match the start/end of
  *each line*, not just the start/end of the whole string — necessary since the fence usually
  isn't on the very first/last character of the whole response.

```python
class AgentError(Exception):
    """Raised when an agent can't produce valid structured output even after a repair."""
```
- A second custom exception type (alongside `RateLimitExceeded`), specifically for "the model
  never gave us something valid, even with a second chance" — distinguished from rate-limit
  failures so the API layer (`main.py`) can return a different HTTP status/`kind` for each.

```python
def _is_retryable(exc: Exception) -> bool:
    s = str(exc).lower()
    if any(tok in s for tok in ("429", "resource_exhausted", "rate", "503", "500",
                                "unavailable", "overloaded", "deadline", "timeout")):
        return True
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    return code in (429, 500, 503)
```
- `str(exc).lower()` — converts whatever exception object was raised into its string message,
  lowercased, so the keyword check below is case-insensitive.
- `any(tok in s for tok in (...))` — a generator expression fed to `any()`: checks "is at least
  one of these substrings present in `s`," short-circuiting (stops checking further tokens) as
  soon as one matches. This is a **string-matching heuristic**, not a structured error-code
  check — a deliberate choice because the Gemini SDK doesn't always raise a uniform exception
  type/shape across all its failure modes, so matching on the message text is the practical way
  to classify an arbitrary exception as "worth retrying" vs. not.
- `getattr(exc, "code", None) or getattr(exc, "status_code", None)` — `getattr(obj, name,
  default)` reads an attribute by name with a fallback if it doesn't exist (avoids an
  `AttributeError` if a particular exception type doesn't have a `.code`). Tries `.code` first,
  falls back to `.status_code` if that's missing/falsy — covers SDK exception types that name
  the attribute differently.
- `return code in (429, 500, 503)` — membership test against a tuple of HTTP status codes,
  as a second, more structured signal layered on top of the string-matching above (belt and
  suspenders: catches the case via attribute if the message-text heuristic above missed it).

```python
def _extract_json(text: str) -> dict:
    """Pull the first balanced JSON object out of a possibly-noisy model response."""
    text = _THINK_TAG.sub("", text)
    text = _FENCE.sub("", text).strip()
    start = text.find("{")
    if start == -1:
        raise ValueError("no JSON object found in model output")
```
- `_THINK_TAG.sub("", text)` — `.sub(replacement, text)` on a compiled regex replaces every
  match with `replacement`; here, every `<think>...</think>` block is deleted (replaced with
  nothing) before anything else happens.
- `_FENCE.sub("", text).strip()` — strips out fence markers, then `.strip()` trims leading/
  trailing whitespace left behind.
- `text.find("{")` — returns the **index** of the first `{` character, or `-1` if there isn't
  one anywhere in the string (a `dict.find`-style "not found" sentinel, as opposed to a method
  like `.index()` which would raise an exception instead).
- `if start == -1: raise ValueError(...)` — fails fast and explicitly if the response contains
  no JSON object at all, rather than letting some later line crash with a confusing, unrelated
  error.

```python
    depth, in_str, esc = 0, False, False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(text[start: i + 1])
    raise ValueError("unbalanced JSON object in model output")
```
This is a **hand-written single-pass parser** that scans character by character to find where
the JSON object that starts at `start` actually *ends* — i.e., its matching closing brace. It's
worth being able to narrate this one in detail; it's the kind of "write a tiny parser" question
that comes up in interviews directly.
- `depth, in_str, esc = 0, False, False` — three pieces of state carried across the loop:
  `depth` = how many `{` we've seen that haven't yet been closed by a matching `}` (0 = we're
  outside any object, or just found the matching close); `in_str` = "are we currently inside a
  quoted JSON string" (because a `{` or `}` *inside a string literal* — e.g. someone's dialogue
  line containing a literal `{` — must NOT be counted as real JSON structure); `esc` = "was the
  previous character inside a string a backslash" (because `\"` inside a JSON string is an
  *escaped* quote, not the end of the string).
- `for i in range(start, len(text)):` — iterate every character index from the first `{` to the
  end of the text. `c = text[i]` — the character at that index.
- `if in_str:` branch — while inside a string: if `esc` was set (previous char was an unescaped
  backslash), this character is "consumed" by that escape (reset `esc`, don't interpret `c`
  specially even if it's a quote). Otherwise, if `c` is itself a backslash, set `esc = True` so
  the *next* character is treated as escaped. Otherwise, if `c` is a `"`, the string just ended
  (`in_str = False`). Any other character inside a string is irrelevant to this parser (it
  doesn't need to validate the string's *contents*, only know when the string ends).
- `else:` branch (outside any string) — if `c` is `"`, a string just started (`in_str = True`).
  If `c` is `{`, increment `depth` (one more unclosed brace). If `c` is `}`, decrement `depth`;
  **if `depth` just hit exactly `0`, this is the closing brace that matches the very first `{`**
  — return `json.loads(text[start : i+1])`, i.e. hand the substring from the opening brace
  through this closing brace (inclusive — slicing is exclusive of the end index, hence `i + 1`)
  to Python's real JSON parser to actually build the dict.
- `raise ValueError("unbalanced JSON object in model output")` — reached only if the loop runs
  off the end of the text without `depth` ever returning to 0 — i.e. the model's output was
  truncated or otherwise malformed enough that the braces never balance.
- **Why not just regex for the whole object, or `json.loads` on the raw text?** Regex can't
  correctly express "balanced nesting to arbitrary depth" (that's not a regular language); and
  `json.loads` on the raw text would fail the instant there's *anything* before/after the JSON
  (a stray sentence, leftover fence markers the earlier `.sub()` calls didn't catch, trailing
  commentary) — this hand-rolled scan is what makes the system tolerant of a model that's 99%
  compliant but occasionally chatty around the edges.

```python
class GeminiClient:
    def __init__(self):
        self.client = genai.Client(api_key=settings.gemini_api_key or None)
        self.model = settings.gemini_model
        self.rl = RateLimiter(settings.rpm_limit, settings.rpd_limit)
```
- `genai.Client(api_key=settings.gemini_api_key or None)` — `or None` means: if
  `gemini_api_key` is an empty string (falsy), pass `None` instead of `""`. This matters because
  the SDK may treat an explicit empty string differently from "not provided" (e.g. trying to use
  it as a literal credential vs. falling back to an environment-variable-based default
  credential lookup) — passing `None` cleanly signals "no key given" rather than "given an empty
  one."
- `self.rl = RateLimiter(...)` — each `GeminiClient` instance owns **its own** rate limiter, with
  its own token bucket and daily counter state — which matters because there's a process-wide
  singleton (`get_client()`, near the bottom of the file) ensuring only **one** `GeminiClient`
  (and therefore one limiter, one set of counters) exists per process; this is the actual
  mechanism behind "the in-memory limiter's accounting requires --max-instances 1" claim made
  elsewhere in the docs.

```python
    # ---- low level ----
    def _config(self, system: str, thinking: bool) -> types.GenerateContentConfig:
        kwargs: dict = dict(system_instruction=system, temperature=settings.temperature)
        if thinking and hasattr(types, "ThinkingConfig"):
            try:
                kwargs["thinking_config"] = types.ThinkingConfig(include_thoughts=True)
            except Exception:
                pass
        return types.GenerateContentConfig(**kwargs)
```
- `kwargs: dict = dict(system_instruction=system, temperature=settings.temperature)` — builds a
  plain dict of keyword arguments to eventually pass into `GenerateContentConfig(...)`, rather
  than constructing the config object directly with all arguments up front — done specifically
  so the `thinking_config` key can be **conditionally** added afterward.
- `hasattr(types, "ThinkingConfig")` — checks whether the installed SDK version even *has* this
  class before trying to use it — a defensive guard against running on an older `google-genai`
  version that predates thinking-mode support, which would otherwise raise an `AttributeError`
  before ever reaching the `try`.
- `try: kwargs["thinking_config"] = types.ThinkingConfig(include_thoughts=True) except Exception:
  pass` — even constructing the config object is wrapped in a try/except that silently swallows
  any failure: if something about this specific SDK/model combination rejects the
  `ThinkingConfig` constructor itself, just proceed without thinking-mode rather than crashing
  the whole request over an enhancement feature.
- `return types.GenerateContentConfig(**kwargs)` — `**kwargs` unpacks the dict into keyword
  arguments (see glossary) — equivalent to calling
  `GenerateContentConfig(system_instruction=..., temperature=..., thinking_config=...)` but built
  up dynamically.

```python
    def _raw_call(self, system: str, contents: str):
        thinking = settings.enable_thinking
        last: Exception | None = None
        for attempt in range(settings.max_retries):
            self.rl.acquire()                       # throttle BEFORE spending a request
            try:
                cfg = self._config(system, thinking)
                return self.client.models.generate_content(
                    model=self.model, contents=contents, config=cfg
                )
            except Exception as exc:                # noqa: BLE001 - we classify below
                last = exc
                msg = str(exc).lower()
                if "thinking" in msg or "thinking_config" in msg:
                    thinking = False                # model/version rejected thinking -> drop it
                    continue
                if not _is_retryable(exc) or attempt == settings.max_retries - 1:
                    raise
                backoff = min((2 ** attempt) + random.random(), 30.0)
                time.sleep(backoff)
        raise last if last else RuntimeError("LLM call failed")
```
This is the retry loop — the heart of the resilience story. Walking through it precisely:
- `thinking = settings.enable_thinking` — a **local, mutable copy** of the global setting; this
  local variable (not the global) gets flipped off mid-loop if thinking turns out to be
  unsupported, so the *next* call from a different request still tries thinking fresh (the
  global setting is never permanently mutated by one bad response).
- `last: Exception | None = None` — tracks the most recent exception seen, so that if the loop
  exhausts all attempts without ever successfully `return`-ing or `raise`-ing earlier, there's
  something to report at the very end.
- `for attempt in range(settings.max_retries):` — `attempt` runs `0, 1, 2, 3, 4` for the default
  `max_retries = 5` — i.e. up to 5 total attempts (not 5 *retries on top of* an initial attempt).
- `self.rl.acquire()` — called **at the top of every attempt, including retries** — every retry
  is itself rate-limited, not just the first attempt; this is what the inline comment means by
  "throttle BEFORE spending a request": you pay the rate-limit cost for an attempt before
  finding out whether that attempt succeeds.
- `cfg = self._config(system, thinking)` / `return self.client.models.generate_content(...)` —
  the actual network call. Note this is a **direct `return`** from inside the `for` loop and the
  `try` block — as soon as a call succeeds, the function exits immediately with that result; the
  rest of the loop (and the final `raise`) is dead code on the success path.
- `except Exception as exc:` with `# noqa: BLE001` — `BLE001` is a linter code (flake8-blind-
  except) that normally flags "don't catch bare `Exception`, it's too broad." The `# noqa`
  comment is a deliberate, explicit suppression of that lint warning, with a reason given inline
  ("we classify below") — i.e. "yes, this is intentionally broad, because the classification
  logic (`_is_retryable`) is what decides what to do next, not the `except` clause itself."
- `if "thinking" in msg or "thinking_config" in msg: thinking = False; continue` — a specific
  carve-out **before** the general retryable check: if the *error itself* mentions "thinking" or
  "thinking_config" (the SDK/model is rejecting that specific feature), disable it and `continue`
  — jump straight to the next loop iteration (which will call `self.rl.acquire()` again — yes,
  this "free" retry still consumes another rate-limit token; this is a known, accepted cost of
  the trade), this time with `thinking=False`, without invoking the general retry/backoff logic
  at all.
- `if not _is_retryable(exc) or attempt == settings.max_retries - 1: raise` — two reasons to give
  up immediately and propagate the exception up to the caller: either the error genuinely isn't
  the kind worth retrying (e.g. a real bad-request error), **or** this was already the last
  allowed attempt (`attempt == max_retries - 1`, i.e. attempt index 4 when `max_retries=5`) — no
  point computing a backoff you're not going to use.
- `backoff = min((2 ** attempt) + random.random(), 30.0)` — **exponential backoff with jitter**,
  capped at 30 seconds. `2 ** attempt` gives `1, 2, 4, 8, 16` seconds across attempts 0-4;
  `+ random.random()` adds a random fraction between 0 and 1 (the "jitter") so that if multiple
  requests are retrying simultaneously, they don't all wake up and retry at the exact same
  instant and immediately collide again — `min(..., 30.0)` prevents the exponential growth from
  ever producing an absurdly long wait.
- `time.sleep(backoff)` — actually pause before the loop's next iteration retries the call.
- `raise last if last else RuntimeError("LLM call failed")` — this line is only reached if the
  `for` loop runs to completion without ever `return`-ing or `raise`-ing from inside it (which,
  given the logic above, shouldn't actually happen in practice since the last iteration always
  either returns or raises) — a defensive fallback: re-raise whatever the last seen exception
  was, or, in the unlikely case there genuinely wasn't one, raise a generic `RuntimeError` so the
  function can never silently return `None`.

```python
    @staticmethod
    def _split_parts(resp) -> tuple[str, str]:
        """Return (answer_text, thought_text) from a thinking-enabled response."""
        answer, thoughts = [], []
        try:
            for part in resp.candidates[0].content.parts:
                txt = getattr(part, "text", None)
                if not txt:
                    continue
                (thoughts if getattr(part, "thought", False) else answer).append(txt)
        except Exception:
            pass
        if not answer:
            answer.append(getattr(resp, "text", "") or "")
        return "".join(answer), "".join(thoughts)
```
- `@staticmethod` — see glossary's decorator note; specifically, this marks the method as not
  needing `self` at all (it doesn't read or write any instance state) — it's only namespaced
  under the class for organization, callable as `GeminiClient._split_parts(resp)` without an
  instance, though it's always actually called as `self._split_parts(resp)` here.
- `answer, thoughts = [], []` — two lists used as string-builders (appending pieces and joining
  at the end is the idiomatic, efficient way to build a string in a loop in Python, rather than
  repeated `+=` on a string, which is much slower because strings are immutable).
- `resp.candidates[0].content.parts` — the Gemini response shape: a list of `candidates` (only
  ever using the first, index `0`), each with `content.parts` — a thinking-enabled response
  splits its output into multiple "parts," some of which are reasoning (marked
  `part.thought = True`) and some of which are the actual answer.
- `txt = getattr(part, "text", None); if not txt: continue` — skips any part that has no text
  content at all (defensive; not every part is guaranteed to carry text).
- `(thoughts if getattr(part, "thought", False) else answer).append(txt)` — a compact
  conditional expression *choosing which list object to call `.append()` on*: if this part is
  flagged as a thought, append to `thoughts`; otherwise append to `answer`. This is a slightly
  unusual but valid pattern — `(a if cond else b)` evaluates to one of the two list objects
  (not a copy, the actual same list), and `.append(txt)` is then called on whichever one was
  selected.
- `except Exception: pass` — if the response doesn't have the expected `candidates[0].content
  .parts` shape at all (e.g. an older SDK response format, or thinking wasn't actually enabled
  for this call), silently give up on this extraction path rather than crashing — the fallback
  below handles that case.
- `if not answer: answer.append(getattr(resp, "text", "") or "")` — if nothing ended up in
  `answer` (either the try block failed, or it succeeded but found no non-thought parts), fall
  back to the SDK response's simpler top-level `.text` convenience property (or an empty string
  if even that's missing) — this is the safety net ensuring the function never returns an empty
  answer if there was *any* text anywhere in the response.
- `return "".join(answer), "".join(thoughts)` — joins each list of string fragments into one
  final string, returned as a 2-tuple `(answer_text, thought_text)`.

```python
    # ---- high level: validated structured generation ----
    def generate_json(self, request_id: str, agent: str, system: str, user: str,
                      schema: Type[T]) -> T:
        """Call Gemini, parse + validate against `schema`, repairing once if needed."""
        schema_str = json.dumps(schema.model_json_schema())
        contents = (
            f"{user}\n\nReturn ONLY a single JSON object that conforms to this JSON Schema. "
            f"No markdown, no commentary outside the JSON.\nSCHEMA:\n{schema_str}"
        )
```
- `schema: Type[T]` — the caller passes the **class itself** (e.g. `Blueprint`, not
  `Blueprint()`), per the `TypeVar`/`Type[T]` generics explained above and in the glossary.
- `schema.model_json_schema()` — a Pydantic class method that introspects the model's fields
  (including every `Field(description=...)`, `min_length`, `ge`/`le` constraint declared in
  `schemas.py`) and produces a JSON Schema dict describing exactly what valid output looks like.
- `json.dumps(...)` — serializes that schema dict into a JSON *string*, because it needs to be
  embedded as literal text inside the prompt sent to the model (the model reads it as part of
  its input text, not as a separate structured parameter — recall from §5 in
  `INTERVIEW_PREP.md` that this project does **not** use Gemini's native `response_schema`
  mode; this is a prompt-based "please match this shape" request instead).
- The f-string appended after `user` is the actual instruction text: explicitly says "ONLY a
  single JSON object," "No markdown, no commentary," and then includes the full schema text —
  this, combined with the tolerant parsing in `_extract_json` and the validation/repair below,
  is the complete structured-output strategy for this whole project.

```python
        started = time.monotonic()
        resp = self._raw_call(system, contents)
        answer, thoughts = self._split_parts(resp)
        log_event(request_id, agent, "call", system=system, user=contents,
                  raw=answer, thoughts=thoughts, latency_s=round(time.monotonic() - started, 2))
```
- `started = time.monotonic()` — start timestamp, for latency measurement (monotonic, not
  wall-clock, since only the *difference* matters and monotonic time can't be thrown off by a
  clock adjustment mid-call).
- `resp = self._raw_call(system, contents)` — this is where everything in `_raw_call` (rate
  limiting, retries, thinking-mode fallback) actually happens; from this method's point of view
  it's just one call that either returns a response or raises after exhausting retries.
- `log_event(...)` — logs the **full** system prompt, full user/contents text, full raw answer,
  full thoughts, and latency, *before* any parsing/validation is attempted — so even if parsing
  fails next, there's already a complete record of exactly what was sent and received, for
  debugging (this is the "multi-agent bugs are miserable to debug" concern from
  `logger.py`'s own docstring, addressed directly).

```python
        try:
            return schema.model_validate(_extract_json(answer))
        except (ValueError, ValidationError) as err:
            # ONE structured repair attempt, then fail gracefully.
            log_event(request_id, agent, "repair", error=str(err))
            repair = (
                f"Your previous response was not valid for the schema.\nERROR: {err}\n"
                f"Return ONLY corrected JSON for this schema (no prose):\n{schema_str}\n"
                f"PREVIOUS OUTPUT:\n{answer[:4000]}"
            )
            resp2 = self._raw_call(system, repair)
            answer2, _ = self._split_parts(resp2)
            log_event(request_id, agent, "repair_call", raw=answer2)
            try:
                return schema.model_validate(_extract_json(answer2))
            except (ValueError, ValidationError) as err2:
                raise AgentError(f"{agent} produced invalid output twice: {err2}") from err2
```
- `schema.model_validate(_extract_json(answer))` — two steps in one expression: first extract
  the balanced JSON object from the raw text (can raise `ValueError` if none/unbalanced), then
  validate that dict against the Pydantic schema (can raise `ValidationError` if the *shape* is
  wrong even though it parsed as valid JSON). Either failure is caught by the same
  `except (ValueError, ValidationError) as err:` — both are treated identically as "the model's
  output wasn't usable," regardless of which exact stage failed.
- On success: this `return` exits `generate_json` entirely — the repair path below is only
  reached if this line raised.
- `repair = (...)` — the repair prompt construction: it includes the literal validation/parse
  error message (`{err}`), the schema again (so the model doesn't have to remember it from
  context), and the previous (broken) output, **truncated to 4000 characters**
  (`answer[:4000]`) — slicing prevents an enormous broken response from making the repair prompt
  itself excessively large (cost and context-window considerations), while still giving the
  model enough of its own prior output to actually fix rather than regenerate from scratch.
- `resp2 = self._raw_call(system, repair)` — note: **same `system` prompt as the original call**
  (the agent's role/identity doesn't change for a repair), only the `contents` (user-side
  message) changes to the repair instructions.
- The second `try/except` mirrors the first exactly, but this time failure is **terminal**:
  `raise AgentError(...) from err2` — raises the custom `AgentError` (signaling "give up, this
  agent failed") while using `from err2` to chain the original second-failure exception as the
  cause, so a traceback/log shows both "this is what ultimately failed" and "here's the
  underlying parse/validation error that caused it" — full diagnostic context preserved rather
  than losing the original error when a new one is raised in its place.

```python
_client: GeminiClient | None = None


def get_client() -> GeminiClient:
    """Lazy singleton so we don't construct a client (or read the key) at import time."""
    global _client
    if _client is None:
        _client = GeminiClient()
    return _client
```
- `_client: GeminiClient | None = None` — a module-level variable, initially `None`; the
  leading underscore is a Python convention (not an enforced rule) signaling "private to this
  module, don't import/use this directly from elsewhere" — code outside this file is meant to
  call `get_client()`, never touch `_client`.
- `global _client` inside the function — without this, the line `_client = GeminiClient()` below
  would create a *new local variable* named `_client` inside the function instead of modifying
  the module-level one; `global` explicitly tells Python "the `_client` I'm assigning to here is
  the module-level name, not a new local."
- `if _client is None: _client = GeminiClient()` — **lazy initialization**: the actual
  `GeminiClient()` (which constructs a `genai.Client`, reads `settings.gemini_api_key`, and
  creates a `RateLimiter`) only happens the *first time* `get_client()` is called, not when this
  module is first imported. The docstring explains why this matters: constructing the client at
  import time would mean *every* import of this module (including, e.g., test files that just
  want to import a type from it) would immediately try to read the API key and talk to Google's
  SDK setup — lazy singleton defers that until the moment it's actually needed.
- `return _client` — every call after the first just returns the same already-built instance —
  this is what makes it a singleton (and, combined with `--max-instances 1`, the single shared
  rate limiter discussed earlier).

---

## 6. `backend/app/prompts_loader.py` — composing the shared voice

```python
"""Compose the shared 'voice' system context from the prompt library.
...
"""
from __future__ import annotations

import re
from functools import lru_cache

from app.config import settings

_BASE = settings.prompts_dir / "script_generator.system.md"
_MOODS = settings.prompts_dir / "moods"
_DIRECTORS = settings.prompts_dir / "directors"

_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_PRETTY = {
    "raj-and-dk": "Raj & DK",
    "tvf-chandan-kumar": "TVF / Chandan Kumar",
    "rajkumar-hirani": "Rajkumar Hirani",
    "sanjay-leela-bhansali": "Sanjay Leela Bhansali",
}
```
- `from functools import lru_cache` — the standard library's memoization decorator, used below
  on `compose_voice`.
- `_BASE`, `_MOODS`, `_DIRECTORS` — `Path` objects built via the `/` operator on
  `settings.prompts_dir` (which itself came from `_REPO_ROOT / "prompts"` in `config.py`) —
  `Path.__truediv__` is overloaded so `/` between paths/strings joins path segments correctly
  for the current OS, rather than needing manual string concatenation with the right slash
  direction.
- `_HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)` — matches an HTML comment
  (`<!-- ... -->`), non-greedily (`.*?`) so multiple separate comments in one file are matched
  individually rather than one match swallowing everything between the *first* `<!--` and the
  *last* `-->`. `re.DOTALL` so a multi-line comment body is matched in one go.
- `_PRETTY = {...}` — a hand-maintained dict mapping a handful of mood/director **ids** (which
  are just filenames, kebab-case) to a properly capitalized/punctuated display label, for the
  cases where naively title-casing the id (turning dashes into spaces and capitalizing each
  word) would produce something wrong — e.g. `"tvf-chandan-kumar"` title-cased naively would be
  `"Tvf Chandan Kumar"`, not the desired `"TVF / Chandan Kumar"`. Only the ids that need special
  handling are listed; everything else falls through to the generic title-casing in `pretty()`.

```python
def _read(path) -> str:
    return path.read_text(encoding="utf-8")


def _block(path) -> str:
    """A library block file minus its own HTML comment header."""
    return _HTML_COMMENT.sub("", _read(path)).strip()
```
- `_read` — a one-line wrapper around `Path.read_text(encoding="utf-8")`; exists mostly for
  readability/reuse (and to centralize the encoding choice in one place) rather than because it
  does anything non-trivial.
- `_block` — reads a file, then strips out HTML comments (every mood/director file starts with
  an authoring-notes comment block explaining what that file is, meant for humans editing the
  library, not for the model) and trims whitespace — this is the "block" of actual prompt
  content with all the scaffolding removed, ready to be spliced directly into the base prompt.

```python
def list_moods() -> list[str]:
    return sorted(p.stem for p in _MOODS.glob("*.md") if p.stem.lower() != "readme")


def list_directors() -> list[str]:
    return sorted(p.stem for p in _DIRECTORS.glob("*.md") if p.stem.lower() != "readme")
```
- `_MOODS.glob("*.md")` — `Path.glob` returns an iterator of every path inside `_MOODS` matching
  the pattern `*.md` (every Markdown file in that directory, non-recursive).
- `p.stem` — a `Path` property giving the filename **without its extension** (`"corporate-war.md"`
  → `"corporate-war"`) — these stems *are* the mood/director ids used everywhere else in the
  app (in `GenerateRequest.mood`, in URLs, etc.).
- `if p.stem.lower() != "readme"` — explicitly excludes a `README.md` file that lives alongside
  the actual mood/director content files in those folders (documentation for whoever's
  authoring new entries) from being treated as a selectable mood/director.
- `sorted(...)` — returns the stems in alphabetical order, so the dropdown lists in the UI have
  a stable, predictable order rather than depending on filesystem iteration order (which isn't
  guaranteed to be consistent across OSes/runs).
- These two functions are what backs `GET /api/options` in `main.py`, and indirectly,
  `GET /api/health`'s `"moods": len(list_moods())` count.

```python
def pretty(idval: str | None) -> str:
    if not idval:
        return "—"
    return _PRETTY.get(idval, idval.replace("-", " ").title())
```
- `if not idval: return "—"` — handles both `None` and an empty string (`""` is falsy too) the
  same way: no selection → display an em dash. This is the single source of the `"—"`
  placeholder used consistently across `Script.directed_in_the_style_of`'s default and any
  UI/meta display.
- `_PRETTY.get(idval, idval.replace("-", " ").title())` — `dict.get(key, default)` looks up
  `idval` in the special-cases dict; if not found, falls back to computing the default
  generically: `.replace("-", " ")` turns `"corporate-war"` into `"corporate war"`, then
  `.title()` capitalizes each word → `"Corporate War"`. Note that **the fallback expression is
  always evaluated** regardless of whether the lookup succeeds (Python evaluates both arguments
  to `.get()` before calling it) — a minor, harmless inefficiency (computing a string that's
  immediately discarded on a dict hit) traded for a one-line implementation.

```python
def _inject(base: str, marker: str, block: str) -> str:
    # Match ONLY standalone-line markers (the real slots), never inline mentions in prose.
    pat = re.compile(
        rf"^[ \t]*<!--\s*{marker}:START\s*-->[ \t]*\n.*?^[ \t]*<!--\s*{marker}:END\s*-->[ \t]*$",
        re.DOTALL | re.MULTILINE,
    )
    return pat.sub(lambda _m: block, base)
```
- `rf"..."` — a string that's both a **raw string** (`r"..."`, so backslashes aren't treated as
  escape sequences — important since the pattern uses regex metacharacters like `\s`) and an
  **f-string** (`f"..."`, so `{marker}` is interpolated with the actual marker name passed in,
  e.g. `"MOOD_DIRECTION"`) at the same time — `rf"..."` (or `fr"..."`) combines both prefixes.
- The pattern, piece by piece: `^[ \t]*` (start of line, optional leading spaces/tabs) +
  `<!--\s*{marker}:START\s*-->` (an HTML comment containing exactly `MOOD_DIRECTION:START`,
  tolerating extra whitespace around the colon-text) + `[ \t]*\n` (rest of that line is just
  whitespace, then a newline) + `.*?` (everything in between, non-greedy — stop at the *first*
  matching end-marker, not the last) + `^[ \t]*<!--\s*{marker}:END\s*-->[ \t]*$` (a mirrored
  closing marker line). `re.MULTILINE` makes `^`/`$` anchor to individual lines (not just the
  whole string); `re.DOTALL` lets `.*?` span multiple lines (the content between START/END is
  always multi-line).
- The inline comment explains the precise reason for this much rigor: it must match **only**
  the standalone marker lines (the actual slot delimiters), not any place the literal text
  "MOOD_DIRECTION" might be casually mentioned in surrounding prose (e.g. the explanatory
  comment block at the top of `script_generator.system.md` *itself mentions* "MOOD_DIRECTION:
  START / MOOD_DIRECTION:END" in plain descriptive text) — anchoring to start-of-line and
  requiring the exact `<!-- marker:START -->`/`<!-- marker:END -->` shape on their own lines is
  what prevents a false match on that descriptive text.
- `pat.sub(lambda _m: block, base)` — `.sub()` normally takes a replacement *string*, but it can
  also take a **function** that receives the match object and returns the replacement string —
  used here (with a throwaway `lambda _m: block` that ignores the match entirely and always
  returns the same fixed `block` text) specifically to avoid a different regex pitfall: if
  `block` itself happens to contain backslash-digit sequences (like `\1`), passing it as a plain
  replacement *string* would cause `re.sub` to interpret those as backreferences and potentially
  corrupt the output. Using a function as the replacement sidesteps that entirely, since
  function-returned replacement text is inserted literally, never re-interpreted.

```python
@lru_cache(maxsize=64)
def compose_voice(mood: str | None, director: str | None) -> str:
    """Build the shared director+mood voice/craft context the agents all share."""
    base = _read(_BASE)

    if mood and (_MOODS / f"{mood}.md").exists():
        base = _inject(base, "MOOD_DIRECTION", _block(_MOODS / f"{mood}.md"))
    if director and (_DIRECTORS / f"{director}.md").exists():
        base = _inject(base, "DIRECTOR_PROFILE", _block(_DIRECTORS / f"{director}.md"))

    # Keep only the 'world bible' (identity + craft + voice + mood); drop the single-shot
    # I/O contract — each agent supplies its own role + output schema.
    cut = base.find("# What you receive")
    if cut != -1:
        base = base[:cut]

    return _HTML_COMMENT.sub("", base).strip()
```
- `@lru_cache(maxsize=64)` — see glossary. The function's arguments (`mood`, `director`) are
  used as the cache key; since both are simple strings or `None`, they're hashable, satisfying
  `lru_cache`'s requirement that arguments be hashable. `maxsize=64` caps how many distinct
  `(mood, director)` results are remembered at once (least-recently-used entries get evicted
  past that) — comfortably above the real combination count (16 moods × 10 directors, plus
  "none selected" variants, is more than 64 in theory, but in practice only a fraction of
  combinations get hit, and re-computing an evicted one is cheap anyway — this isn't trying to
  cache literally every possible combination, just avoid redundant file I/O for popular ones).
- `if mood and (_MOODS / f"{mood}.md").exists():` — two conditions: `mood` must be truthy (not
  `None`/empty), **and** the corresponding file must actually exist — if a client sends a mood
  id that doesn't correspond to any real file (a typo, a stale id from an old deploy), this
  silently skips injection rather than crashing, leaving the **default** mood text (already
  present in the base file, between the START/END markers, as a hard-coded fallback) in place.
- `_inject(base, "MOOD_DIRECTION", _block(...))` — read just that file's content block, then
  splice it in place of the marker region in `base`. Same pattern repeated for `DIRECTOR_PROFILE`.
  Both injections, when they happen, operate on the progressively-modified `base` string (mood
  injected first, then director injected into the *already-mood-modified* text) — order doesn't
  actually matter here since the two markers are in different locations and don't interact, but
  it's worth noting `base` is being reassigned twice, not building from two independent copies.
- `cut = base.find("# What you receive")` / `if cut != -1: base = base[:cut]` — finds the
  heading that starts the (now-irrelevant) single-shot I/O contract section, and **slices the
  string to throw away everything from that heading onward** (`base[:cut]` = everything before
  index `cut`). If the heading isn't found at all (`cut == -1`), this is skipped entirely and
  the full text is kept as-is — a defensive no-op rather than accidentally truncating at index
  `-1` (which in Python slicing would actually cut off only the *last character* — a real bug
  that's correctly avoided here by the explicit `!= -1` check).
- `_HTML_COMMENT.sub("", base).strip()` — final cleanup pass: strip any remaining HTML comments
  (e.g. the big top-of-file authoring-notes comment in the base prompt itself) and trim
  surrounding whitespace, before returning the fully composed, model-ready text.

---

## 7. `backend/app/agents.py` — the agents themselves

```python
"""The agents. Each has ONE narrow job and a validated structured output.
...
"""
from __future__ import annotations

from app.llm.client import GeminiClient
from app.schemas import (
    Blueprint, CharactersOut, Critique, DialogueOut, MetaOut, Scene, ScenesOut, Script,
)
```
- Plain imports — note this file imports `GeminiClient` (the *type*, for type hints on function
  parameters) but never constructs one itself; every agent function takes a `client:
  GeminiClient` parameter and is handed an already-built instance (from `get_client()`, called
  in `pipeline.py`) — **dependency injection** in spirit, even without a formal DI framework:
  this is what makes the agent functions trivially testable with a fake/mock client if needed.

```python
# ---------------------------------------------------------------- role prompts
ARCHITECT_ROLE = """# YOUR ROLE: ARCHITECT (pre-production)
You do NOT write full scenes yet. Read the situation and design the film's blueprint:
- movie_title, tagline, logline (in this film's register and the director's voice)
- characters: each with name, role, description, and internally their want, fear, and contradiction
- scene_plan: an ordered list of beats. YOU decide how many scenes the drama needs (no fixed
  number) so it feels complete and gloriously over-engineered. For each beat give: scene_index,
  intent (what happens / what turns), heading (INT./EXT. LOCATION - TIME), characters (names),
  and escalation (how it is bigger than the previous beat).
The plan must escalate beat over beat and end with intent. Output the blueprint JSON only."""
```
- Module-level string constants (`ARCHITECT_ROLE`, etc.) — these are just **plain strings**, not
  functions; they're concatenated with the shared "voice" text at call time (`voice + "\n\n" +
  ARCHITECT_ROLE`, seen below). Using `"""triple-quoted"""` strings lets the role description
  span many lines naturally with real line breaks, rather than needing `\n` escapes or string
  concatenation across multiple `+` lines.
- Content-wise: explicitly tells the model **what NOT to do yet** ("You do NOT write full scenes
  yet") — as important as what it should do, since without that line a capable model might
  "helpfully" produce full scene prose at the planning stage, defeating the separation of
  concerns between Architect and Screenwriter. "YOU decide how many scenes... no fixed number"
  is the explicit instruction backing the "no scene-count cap" design decision documented
  elsewhere. "Output the blueprint JSON only" is a closing instruction repeated at the end of
  nearly every role prompt — reinforcing, right before generation, "don't add prose around the
  JSON," immediately adjacent to where the model is about to start producing output.

```python
LANGUAGE_RULE = """LANGUAGE (non-negotiable): scene_description is in clear English. Every dialogue
line is in natural HINGLISH — Hindi-led, Roman script, the way people actually talk, with English
words mixed in only for modern/technical/business terms (vision, startup, deadline, vibe, fix kar).
Most of a line's words should be Hindi, not English. Never write a dialogue line in plain English."""
```
- A **shared sub-prompt constant**, reused (via Python f-string interpolation, see next block)
  inside every role prompt that involves writing or rewriting dialogue — `SCREENWRITER_ROLE`,
  `REVISE_ROLE`, `REGEN_SCENE_ROLE`, `REGEN_DIALOGUE_ROLE` all embed this exact same text. Notice
  it's defined **once** and reused, rather than copy-pasted into each role string — if the
  Hinglish rule's wording ever needs to change, there's exactly one place to edit, and every
  agent that needs it picks up the change automatically.

```python
SCREENWRITER_ROLE = f"""# YOUR ROLE: SCREENWRITER
Write EVERY scene fully from the blueprint, in order. For each scene: scene_index (matching the
plan), scene_title (short), heading, scene_description (what happens and how it is staged), and
dialogue as a list of {{character, delivery, line}}. Honor the register and the director's voice.
Keep characters perfectly consistent with the blueprint and escalate scene over scene.
{LANGUAGE_RULE}
Output {{"scenes": [...]}} only."""
```
- `f"""..."""` — an f-string that's also triple-quoted (multi-line). `{LANGUAGE_RULE}` inside it
  is real interpolation — at module-load time, Python substitutes the actual `LANGUAGE_RULE`
  string content in at that point, so `SCREENWRITER_ROLE` ends up containing the full Hinglish
  rule text inline, baked into the constant once, not re-read at call time.
- `{{character, delivery, line}}` and `{{"scenes": [...]}}` — **doubled curly braces**. Because
  this is an f-string, a single `{` would be interpreted as "start of an interpolation
  expression" — to write a *literal* curly brace in an f-string's output, you escape it by
  doubling it (`{{` → literal `{`, `}}` → literal `}`). This is necessary here specifically
  because the text is describing JSON shape (which uses literal braces) while *also* needing to
  interpolate `{LANGUAGE_RULE}` elsewhere in the same string — if it didn't need any
  interpolation at all, it could've just been a plain (non-f) triple-quoted string with single
  braces.
- Note `Output {{"scenes": [...]}} only.` is the human-readable echo of the same shape that
  `ScenesOut` (in `schemas.py`) formally enforces — the prompt text and the schema say the same
  thing in two different ways (informal instruction + formal validation), which is intentional
  redundancy, not duplication-by-accident.

```python
REVISE_ROLE = f"""# YOUR ROLE: SCREENWRITER (revision pass)
You are revising your draft against the Script Doctor's notes. Fix EVERY listed issue while
keeping what already works; preserve scene_index numbering and character consistency. Do not
weaken the climax.
{LANGUAGE_RULE}
Output the full corrected {{"scenes": [...]}} only."""
```
- A **separate, distinct role prompt** used only on a revision pass (as opposed to
  `SCREENWRITER_ROLE`'s first-pass wording) — `screenwriter()` (below) picks between the two
  based on whether a `critique` was passed in. "Fix EVERY listed issue while keeping what
  already works" and "Do not weaken the climax" are specific guardrails against two predictable
  failure modes of revision: (a) ignoring some of the critic's notes, and (b) over-correcting
  and accidentally making the ending worse while fixing something unrelated.

```python
CRITIC_ROLE = """# YOUR ROLE: SCRIPT DOCTOR (quality control)
Judge the assembled script hard but fairly. Check:
- escalation: each scene bigger / higher-stakes than the one before; climax stronger than the open
- consistency: characters, world, and established facts hold across scenes
- register fit: it genuinely matches the intended mood/register
- dialogue: at least one memorable, quotable line per scene; voices are distinct
- language: scene_description is in English AND every dialogue line is genuinely Hinglish
  (Hindi-led, Roman script) — flag any line that is plain English as an issue to fix
- structure: a clear climax and a deliberate ending; every scene has description + dialogue
Return {passed, score 0-100, issues:[{scene_index, problem, fix}], note}. Pass ONLY if it is
genuinely strong; otherwise give concrete, actionable fixes (not vibes). Output JSON only."""
```
- Note this one is a **plain** triple-quoted string, not an f-string (no `f` prefix) — it
  doesn't need to interpolate `LANGUAGE_RULE` or anything else, so the curly braces in
  `{passed, score 0-100, ...}` are written as single braces with no escaping needed, since
  there's no f-string parsing happening on this string at all.
- This is the rubric from the original 6-node design (`docs/ARCHITECTURE.md`'s "craft +
  escalation + consistency" Critic) compressed into one agent's instructions — six concrete
  checks, each one a plain-English criterion rather than a vague "is this good" ask. "Pass ONLY
  if it is genuinely strong... not vibes" is explicitly steering the model away from being a
  rubber-stamp critic that always passes, which would make the always-on critic loop pointless.

```python
REGEN_SCENE_ROLE = f"""# YOUR ROLE: SCREENWRITER (single-scene rewrite)
Rewrite ONLY the requested scene. The other scenes are LOCKED CANON — do not change them, and
keep your new scene fully consistent with them and with the characters. Keep the same scene_index.
Make it stronger and fresh.
{LANGUAGE_RULE}
Output the single rewritten scene JSON only."""

REGEN_DIALOGUE_ROLE = f"""# YOUR ROLE: DIALOGUE PASS (one scene)
Rewrite ONLY the dialogue of the requested scene. Keep the scene's heading and scene_description
unchanged in meaning, and keep the same speakers (from the character list). Make the lines punchier
and more memorable while staying true to the register and voice.
{LANGUAGE_RULE}
Output {{"dialogue": [...]}} only."""

REGEN_META_ROLE = """# YOUR ROLE: TITLE & TAGLINE
Given the film, produce a fresh movie_title, tagline, and one-line logline that are blockbuster-worthy
and true to the register and voice. Output {movie_title, tagline, logline} only."""

REGEN_CHARACTERS_ROLE = """# YOUR ROLE: CHARACTER FORGE
Recast the characters to be more vivid and memorable while keeping them compatible with the existing
scenes. Each: name, role, description (+ internal want, fear, contradiction). Output {"characters": [...]} only."""
```
- The four regeneration role prompts. Each repeats the same structural pattern: state the
  narrow job, state what must stay fixed/untouched ("LOCKED CANON," "keep the same speakers,"
  "compatible with the existing scenes"), and end with the exact output shape. `REGEN_META_ROLE`
  and `REGEN_CHARACTERS_ROLE` are plain strings (no `LANGUAGE_RULE` interpolation needed — titles/
  taglines and character *descriptions* aren't dialogue, so the Hinglish rule doesn't apply to
  them) — only the two regen roles that touch actual spoken dialogue (`REGEN_SCENE_ROLE`,
  `REGEN_DIALOGUE_ROLE`) are f-strings embedding `LANGUAGE_RULE`.

```python
# ---------------------------------------------------------------- agent calls
def architect(client: GeminiClient, voice: str, request_id: str, situation: str,
              characters_hint: str | None = None) -> Blueprint:
    user = f"SITUATION:\n{situation or '(none provided — invent a fitting everyday situation)'}"
    if characters_hint:
        user += f"\n\nCHARACTER HINTS: {characters_hint}"
    return client.generate_json(request_id, "architect", voice + "\n\n" + ARCHITECT_ROLE, user, Blueprint)
```
- `situation or '(none provided — invent a fitting everyday situation)'` — `or` here is doing
  **fallback substitution**: if `situation` is falsy (empty string), use the fallback text
  instead. This is what lets a user generate a movie with a completely blank input — the
  Architect is explicitly told to just invent something rather than receiving an empty/blank
  instruction it might not know how to handle.
- `if characters_hint: user += ...` — conditionally appends an extra section to the user message
  only when the caller actually provided a `characters_hint` (an optional field on
  `GenerateRequest` that, looking at the frontend, isn't currently wired into the UI — it's
  schema-supported but not exposed as an input control yet; the backend logic for it is fully
  ready regardless).
- `client.generate_json(request_id, "architect", voice + "\n\n" + ARCHITECT_ROLE, user, Blueprint)`
  — the actual call: `request_id` and `"architect"` (the agent name, used purely for logging/
  tracing labels), the **composed system prompt** (shared voice context, blank-line-separated,
  then this agent's specific role text), the **user message** built above, and `Blueprint` — the
  schema class itself, telling `generate_json` both what shape to validate against and (via its
  generic return type `T`) what type this function itself returns.

```python
def screenwriter(client: GeminiClient, voice: str, request_id: str, blueprint: Blueprint,
                 critique: Critique | None = None, prev: list[Scene] | None = None) -> list[Scene]:
    role = REVISE_ROLE if critique else SCREENWRITER_ROLE
    user = "BLUEPRINT:\n" + blueprint.model_dump_json(indent=2)
    if critique and prev:
        user += "\n\nYOUR PREVIOUS SCENES:\n" + ScenesOut(scenes=prev).model_dump_json(indent=2)
        user += "\n\nSCRIPT DOCTOR NOTES TO ADDRESS:\n" + critique.model_dump_json(indent=2)
    out = client.generate_json(request_id, "screenwriter", voice + "\n\n" + role, user, ScenesOut)
    return out.scenes
```
- `role = REVISE_ROLE if critique else SCREENWRITER_ROLE` — the conditional expression that
  picks between first-pass and revision-pass instructions, based purely on whether a `critique`
  argument was supplied at all (truthy check on the object, not on any specific field of it).
- `blueprint.model_dump_json(indent=2)` — serializes the `Blueprint` Pydantic object to a JSON
  *string* (not a dict) directly, with 2-space indentation for human/model readability in the
  logged prompt — `model_dump_json` is a one-step "dump to JSON text" shortcut, versus
  `json.dumps(blueprint.model_dump())` which would be the two-step equivalent.
- `if critique and prev: ...` — both must be present (not just `critique` alone) to include the
  "previous scenes" and "notes to address" sections; this guards against a (currently
  unreachable, given how `pipeline.py` calls this) situation where a critique exists without
  prior scenes to compare against.
- `ScenesOut(scenes=prev).model_dump_json(indent=2)` — constructs a *temporary* `ScenesOut`
  wrapper object purely to get its nice `{"scenes": [...]}`-shaped JSON serialization — `prev`
  is just a plain `list[Scene]`, and wrapping it in `ScenesOut` before dumping reuses the same
  wrapper type the model itself is asked to produce, so the previous-scenes section in the
  prompt is shaped identically to what the model is being asked to output again.
- `out = client.generate_json(..., ScenesOut)` / `return out.scenes` — the call returns a full
  `ScenesOut` object (because that's the schema/contract requested), but this function's own
  declared return type is `list[Scene]` — so the last line unwraps the wrapper, handing the
  caller (`pipeline.py`) just the list it actually cares about. This is the wrapper pattern from
  `schemas.py` being used and then immediately discarded at the boundary where it's no longer
  needed.

```python
def critic(client: GeminiClient, voice: str, request_id: str, script: Script) -> Critique:
    user = "SCRIPT TO JUDGE:\n" + script.model_dump_json(indent=2)
    return client.generate_json(request_id, "critic", voice + "\n\n" + CRITIC_ROLE, user, Critique)
```
- Note this takes a full **`Script`** (the assembled object — title, tagline, characters, *and*
  scenes together), not separately a blueprint and a scene list — this is deliberate: the critic
  needs to judge the film holistically (does scene 3 escalate past scene 2, does the title match
  the tone, etc.), which requires seeing everything assembled in one piece, not the disjoint
  working-memory pieces other nodes use.

```python
def regen_scene(client: GeminiClient, voice: str, request_id: str, script: Script,
                index: int, note: str | None) -> Scene:
    locked = [s for s in script.scenes if s.scene_index != index]
    target = next((s for s in script.scenes if s.scene_index == index), None)
    user = (
        f"FILM: {script.movie_title}\nCHARACTERS:\n"
        + "\n".join(f"- {c.name} ({c.role}): {c.description}" for c in script.characters)
        + "\n\nLOCKED CANON SCENES (do not change):\n"
        + ScenesOut(scenes=locked or [target or script.scenes[0]]).model_dump_json(indent=2)
        + f"\n\nSCENE TO REWRITE (scene_index {index}):\n"
        + (target.model_dump_json(indent=2) if target else "(create a new scene at this index)")
        + f"\n\nNOTE: {note or 'make it stronger and fresh; keep the same index and full continuity'}"
    )
    return client.generate_json(request_id, "regen_scene", voice + "\n\n" + REGEN_SCENE_ROLE, user, Scene)
```
- `locked = [s for s in script.scenes if s.scene_index != index]` — a list comprehension (see
  glossary) building the "everything except the targeted scene" list — this is the literal
  Python expression of "the other scenes are locked canon."
- `target = next((s for s in script.scenes if s.scene_index == index), None)` — `next(iterator,
  default)` pulls the first item out of a generator expression (note the parens, not square
  brackets — `(s for s in ... if ...)` is a *generator* expression, evaluated lazily one item at
  a time, versus a list comprehension which builds the whole list upfront; here only the first
  match is ever needed, so a generator avoids scanning/building more than necessary), or `None`
  if nothing matches the `scene_index == index` condition — this is the idiomatic Python way to
  write "find the first item matching a condition, or `None` if there isn't one."
- `"\n".join(f"- {c.name} ({c.role}): {c.description}" for c in script.characters)` — builds a
  human-readable bulleted character list by joining a generator of formatted lines with newline
  separators — `str.join` on a generator expression directly (no need to materialize a list
  first) is a common, idiomatic pattern for this.
- `ScenesOut(scenes=locked or [target or script.scenes[0]])` — a defensive fallback chain: if
  `locked` is empty (meaning *every* scene in the script had the targeted index — i.e. there's
  only one scene total, or somehow they're all duplicates of the same index), fall back to a
  list containing just `target` (the one matching scene), or if even *that's* `None` (the index
  didn't exist at all), fall back to the script's very first scene — ensuring the "locked canon"
  list passed to the model is never actually empty (an empty list here might confuse the model
  into thinking there's no other context at all, in an edge case that shouldn't normally occur
  but is guarded against anyway).
- `target.model_dump_json(indent=2) if target else "(create a new scene at this index)"` — a
  conditional expression: if a scene at that index was actually found, show its current content
  (for the model to rewrite); if not (the caller asked to "regenerate" an index that doesn't
  exist in the script — e.g. via a manually-crafted request, or a stale client state), tell the
  model explicitly to create a brand-new scene at that index instead of erroring out.
- `note or 'make it stronger and fresh; ...'` — same fallback-substitution pattern as
  `architect()`'s situation handling: if the optional user steer text wasn't provided, supply a
  sensible default instruction instead of leaving that section of the prompt blank or absent.
- The whole `user` string is built via **string concatenation across multiple lines** (a single
  parenthesized expression spanning many `+`-joined pieces) rather than one giant f-string —
  readable here because several of the pieces are themselves multi-step expressions (the joined
  character list, the conditional target text) that would be awkward to inline directly into an
  f-string's `{}` slots.

```python
def regen_dialogue(client: GeminiClient, voice: str, request_id: str, script: Script,
                   index: int, note: str | None) -> DialogueOut:
    target = next((s for s in script.scenes if s.scene_index == index), None)
    if target is None:
        raise ValueError(f"scene_index {index} not found")
    user = (
        f"FILM: {script.movie_title}\nSPEAKERS: {', '.join(c.name for c in script.characters)}\n"
        f"\nSCENE (keep heading + description meaning, rewrite dialogue):\n"
        + target.model_dump_json(indent=2)
        + f"\n\nNOTE: {note or 'punch up the lines, more memorable, same beats'}"
    )
    return client.generate_json(request_id, "regen_dialogue", voice + "\n\n" + REGEN_DIALOGUE_ROLE, user, DialogueOut)
```
- `if target is None: raise ValueError(...)` — **unlike** `regen_scene` (which tolerates a
  missing index by asking the model to invent a new scene), this function treats a missing
  index as a genuine caller error and raises immediately — makes sense semantically: you can't
  "rewrite the dialogue of" a scene that doesn't exist; there's nothing sensible to fall back to
  the way there was for a whole-scene regeneration. This `ValueError` propagates up uncaught
  through `pipeline.py`'s node into the generic `except Exception` handler in `main.py`,
  surfacing as a `500 server` error — a reasonable outcome for what amounts to an invalid
  request the client shouldn't be able to construct via the normal UI anyway.
- `", ".join(c.name for c in script.characters)` — builds a comma-separated speaker name list
  (e.g. "Raj, Priya, Mr. Sharma") directly from a generator expression.

```python
def regen_meta(client: GeminiClient, voice: str, request_id: str, script: Script,
               note: str | None) -> MetaOut:
    user = (
        f"FILM register: {script.mood}\nLOGLINE: {script.logline}\n"
        f"FIRST SCENE: {script.scenes[0].scene_description[:600]}\n"
        f"\nNOTE: {note or 'give a fresh blockbuster title, tagline, and logline'}"
    )
    return client.generate_json(request_id, "regen_meta", voice + "\n\n" + REGEN_META_ROLE, user, MetaOut)
```
- `script.scenes[0].scene_description[:600]` — only the **first 600 characters** of the first
  scene's description, not the whole script — a deliberate economy: a fresh title/tagline only
  needs *enough* context to stay thematically appropriate, not the entire script text (which
  would bloat the prompt for no benefit to this narrow task); `[:600]` is string slicing,
  safely returning the whole string if it's shorter than 600 characters (no index-out-of-range
  error from over-slicing in Python).

```python
def regen_characters(client: GeminiClient, voice: str, request_id: str, script: Script,
                     note: str | None) -> CharactersOut:
    user = (
        f"FILM: {script.movie_title} ({script.mood})\nCURRENT CHARACTERS:\n"
        + script.model_dump_json(include={"characters"}, indent=2)
        + f"\n\nNOTE: {note or 'make them more vivid; keep them compatible with the existing scenes'}"
    )
    return client.generate_json(request_id, "regen_characters", voice + "\n\n" + REGEN_CHARACTERS_ROLE, user, CharactersOut)
```
- `script.model_dump_json(include={"characters"}, indent=2)` — `include={"characters"}` is a
  Pydantic serialization filter: dump the model to JSON but **only** the `characters` field,
  omitting `movie_title`/`tagline`/`scenes`/etc. even though they exist on the `Script` object —
  this is more direct than manually building a `{"characters": [...]}` dict by hand, while
  achieving the same "send the model only what's relevant to recasting" effect as the truncated
  scene description in `regen_meta` above — both functions deliberately narrow what context they
  forward, in the spirit of "pass each agent only what it needs" from this file's own docstring.

---

## 8. `backend/app/graph/pipeline.py` — the LangGraph orchestration

```python
"""LangGraph orchestration: nodes, edges, the always-on critic loop, and regen routing.
...
"""
from __future__ import annotations

import time

from langgraph.graph import END, START, StateGraph

from app.agents import (
    architect, critic, regen_characters, regen_dialogue, regen_meta, regen_scene, screenwriter,
)
from app.config import settings
from app.graph.state import ScriptState
from app.llm.client import AgentError, get_client
from app.observability.logger import log_event
from app.prompts_loader import compose_voice, pretty
from app.schemas import Blueprint, Critique, Scene, Script
```
- `from langgraph.graph import END, START, StateGraph` — `START`/`END` are LangGraph's special
  sentinel node names marking the graph's entry/exit points; `StateGraph` is the class used to
  declare nodes and edges and `.compile()` them into a runnable graph.
- This file imports **every** agent function from `agents.py` at once via one parenthesized
  multi-line import — and imports `get_client` (not a client instance) from `client.py`,
  consistent with the "lazy singleton, fetched fresh inside each node" pattern seen below.

```python
# ----------------------------------------------------------------- helpers
def _trace(state: ScriptState, step: str, status: str, **detail) -> list:
    rec = {"step": step, "status": status, "ts": round(time.time(), 3), **detail}
    return list(state.get("trace", [])) + [rec]
```
- `**detail` — gathers any extra keyword arguments the caller passes (e.g. `title=...,
  scenes_planned=...`) into a dict named `detail`.
- `rec = {"step": step, "status": status, "ts": round(time.time(), 3), **detail}` — builds one
  trace record dict: fixed fields (`step`, `status`, a timestamp rounded to millisecond
  precision) plus whatever extra detail fields were passed in, merged via `**detail` (dict-merge
  unpacking inside a literal, see glossary).
- `list(state.get("trace", [])) + [rec]` — `state.get("trace", [])` reads the existing trace list
  (or an empty list if this is the very first trace entry of the request — recall `ScriptState`
  is `total=False`, so `trace` might not be present yet). `list(...)` wraps it to make an
  explicit **new** list object (a defensive copy), and `+ [rec]` appends the new record by
  concatenation, producing a brand-new list rather than mutating the old one in place
  (`.append()` would mutate `state["trace"]`'s underlying list object directly, which would be
  unsafe to do given LangGraph's state-merging model — returning a *new* list as part of a
  node's returned partial-state dict is the correct, side-effect-free way to update state in
  this kind of system).

```python
def _clean_mood(value: str | None, fallback: str) -> str:
    """A mood label is short (e.g. 'Maximum Drama'). The model occasionally echoes the
    whole mood-direction block into this field; reject anything long/multi-line so it
    can't blow up the poster, and fall back to the user-picked label."""
    v = (value or "").strip()
    if not v or len(v) > 40 or "\n" in v:
        return fallback
    return v
```
- `v = (value or "").strip()` — `value or ""` converts a possible `None` into an empty string
  first (so `.strip()` never fails on `None`), then `.strip()` trims surrounding whitespace.
- `if not v or len(v) > 40 or "\n" in v: return fallback` — three independent rejection
  conditions, any one of which is disqualifying: empty after stripping, longer than 40
  characters, or contains a literal newline character (a strong signal of the multi-paragraph
  mood-instruction-block leak this guard exists to catch — a real short label like "Maximum
  Drama" is never multi-line). `"\n" in v` is Python's substring-containment check, here testing
  for the newline character specifically.
- `return v` — only reached if none of the rejection conditions triggered; returns the
  (stripped) original value as genuinely acceptable.

```python
def _assemble_full(state: ScriptState) -> Script:
    bp = Blueprint.model_validate(state["blueprint"])
    scenes = [Scene.model_validate(s) for s in state.get("scenes", [])]
    scenes.sort(key=lambda s: s.scene_index)
    mood_fallback = pretty(state.get("mood")) if state.get("mood") else "Maximum Drama"
    return Script(
        movie_title=bp.movie_title,
        tagline=bp.tagline,
        mood=_clean_mood(bp.mood, mood_fallback),
        logline=bp.logline,
        directed_in_the_style_of=pretty(state.get("director")),
        characters=bp.characters,
        scenes=scenes,
    )
```
This is the function that turns the raw working-memory pieces of state into the final, public
`Script` object — called by the `critic` node (to have something complete to judge) and the
`finalize` node (to produce the actual output).
- `bp = Blueprint.model_validate(state["blueprint"])` — `state["blueprint"]` is a plain dict
  (recall `ScriptState`'s `blueprint: dict` typing); `Blueprint.model_validate(...)` re-hydrates
  it back into a real `Blueprint` object so its typed attributes (`bp.movie_title`, etc.) can be
  accessed normally below, instead of doing raw dict-key lookups everywhere.
- `[Scene.model_validate(s) for s in state.get("scenes", [])]` — same dict→object round-trip,
  applied to every scene dict in the list (a list comprehension, see glossary), defaulting to an
  empty list if `scenes` isn't in state yet (shouldn't normally happen by the time this is
  called, but `.get(..., [])` is cheap insurance against a `KeyError` either way).
- `scenes.sort(key=lambda s: s.scene_index)` — sorts the list **in place** (`.sort()`, not the
  `sorted()` builtin which would return a new list) by each scene's `scene_index`. `key=lambda
  s: s.scene_index` is a one-line anonymous function telling `.sort()` what value to compare
  each item by. This matters because the Screenwriter writes scenes "in order" per its prompt,
  but nothing *guarantees* the model returns them in strictly ascending order in the JSON array
  — sorting explicitly in code removes any dependence on the model getting that detail right.
- `mood_fallback = pretty(state.get("mood")) if state.get("mood") else "Maximum Drama"` — a
  conditional expression: if the user actually selected a mood (non-empty `state["mood"]`), use
  its pretty display label as the fallback (e.g. if mood-cleaning rejects the model's `bp.mood`
  value, fall back to *what the user actually picked*, not a generic default); if no mood was
  selected at all, fall back to the literal string `"Maximum Drama"` — the documented default
  register for an unguided generation.
- `mood=_clean_mood(bp.mood, mood_fallback)` — this is where the mood-bug fix (§7.4 in
  `INTERVIEW_PREP.md`) actually gets applied: the model's raw `bp.mood` value is passed through
  the guard with the just-computed fallback, every single time a `Script` is assembled.
- `directed_in_the_style_of=pretty(state.get("director"))` — note this is **not** taken from the
  model's own self-reported director field anywhere (the `Blueprint` schema doesn't even have a
  `directed_in_the_style_of` field) — it's derived purely from the user's actual selection
  (`state["director"]`, the id) via `prompts_loader.pretty()`, sidestepping any possibility of
  the model getting this field wrong, by never asking the model to produce it as free text in
  the first place.

```python
# ----------------------------------------------------------------- nodes
def n_dispatch(state: ScriptState) -> dict:
    voice = compose_voice(state.get("mood"), state.get("director"))
    return {"voice_system": voice, "iteration": 0,
            "trace": _trace(state, "dispatch", "done", mode=state.get("mode", "full"))}
```
- Every node function takes the **current state** and returns a **partial dict** — this is the
  LangGraph node contract: whatever's returned gets shallow-merged into the running state by the
  graph runtime (not replacing the whole state — only the keys present in the returned dict are
  updated; everything else in state is left untouched).
- `compose_voice(state.get("mood"), state.get("director"))` — calls the (cached) prompt
  composer once per request, building the shared voice context that every subsequent agent in
  this request will reuse.
- The returned dict sets three keys: `voice_system` (so later nodes can read `state[
  "voice_system"]`), resets `iteration` to `0` (the screenwriter-pass counter, about to start
  fresh), and appends a trace record. `state.get("mode", "full")` — defaults to `"full"` if
  `mode` wasn't set at all (shouldn't normally happen since `main.py` always sets it, but a safe
  default regardless).

```python
def n_architect(state: ScriptState) -> dict:
    bp = architect(get_client(), state["voice_system"], state["request_id"],
                   state.get("situation", ""), state.get("characters_hint"))
    return {"blueprint": bp.model_dump(),
            "trace": _trace(state, "architect", "done",
                            title=bp.movie_title, scenes_planned=len(bp.scene_plan),
                            characters=len(bp.characters))}
```
- `get_client()` — fetches the process-wide singleton `GeminiClient` fresh, inside the node
  function itself (not passed in from outside) — every node that calls an agent does this same
  `get_client()` call; since it's a cached singleton, this has no real performance cost, it's
  just how each node independently accesses the shared client without needing it threaded
  through as an explicit graph-level dependency.
- `state["voice_system"], state["request_id"]` — **direct bracket indexing** (not `.get(...)`)
  here, deliberately: by the time `architect` runs, both of these keys are *guaranteed* to exist
  (`voice_system` was just set by `dispatch`, which always runs first; `request_id` is set by
  `main.py` before the graph even starts) — using `[...]` instead of `.get(...)` means a missing
  key would raise a loud `KeyError` immediately rather than silently proceeding with `None`,
  which is the *correct* failure mode for state that should never actually be absent at this
  point in the flow.
- `bp.model_dump()` — converts the returned `Blueprint` object back into a plain dict for
  storage in state (the dict↔object round-trip pattern noted earlier, now seen at the point
  it's produced).
- The trace detail fields (`title`, `scenes_planned=len(bp.scene_plan)`,
  `characters=len(bp.characters)`) are specifically chosen to be useful, glanceable summary
  numbers for the live "Agent Thinking" UI panel — not the full blueprint content (which would
  be far too much to display inline in a trace step), just enough to show progress meaningfully.

```python
def n_screenwriter(state: ScriptState) -> dict:
    bp = Blueprint.model_validate(state["blueprint"])
    crit = Critique.model_validate(state["critique"]) if state.get("critique") else None
    prev = [Scene.model_validate(s) for s in state.get("scenes", [])] if crit else None
    scenes = screenwriter(get_client(), state["voice_system"], state["request_id"], bp, crit, prev)
    n = state.get("iteration", 0) + 1
    return {"scenes": [s.model_dump() for s in scenes], "iteration": n,
            "trace": _trace(state, "screenwriter", "done",
                            pass_no=n, scenes_written=len(scenes),
                            revision=bool(crit))}
```
- `crit = Critique.model_validate(state["critique"]) if state.get("critique") else None` —
  conditional expression: only attempt to rebuild a `Critique` object if `state["critique"]`
  actually exists and is truthy (it won't, on the very first pass through this node — only after
  a `critic` run that didn't pass). This is the key branch point that determines first-pass vs.
  revision-pass behavior, computed *here*, then handed down into `agents.screenwriter()` which
  uses `crit`'s truthiness to choose `REVISE_ROLE` vs `SCREENWRITER_ROLE`.
- `prev = [...] if crit else None` — **only** bothers reconstructing the previous scenes list if
  there's actually a critique to revise against — on a first pass, there's no "previous attempt"
  to show the model, so this stays `None` (and `agents.screenwriter()`'s own `if critique and
  prev:` check, seen earlier, is the second half of this same guard).
- `n = state.get("iteration", 0) + 1` — increments the pass counter; defaults the starting point
  to `0` defensively, though in practice `dispatch` already initialized it to `0`.
- `[s.model_dump() for s in scenes]` — converts every returned `Scene` object back to a dict for
  storage, via list comprehension.
- `revision=bool(crit)` — records in the trace whether this particular screenwriter pass was a
  first draft or a revision — `bool(None)` is `False`, `bool(<some Critique object>)` is `True`
  (a real object instance is always truthy unless its class defines otherwise, which `Critique`
  doesn't) — this is what lets the UI label a step "revision pass" distinctly from "first draft."

```python
def n_critic(state: ScriptState) -> dict:
    crit = critic(get_client(), state["voice_system"], state["request_id"], _assemble_full(state))
    return {"critique": crit.model_dump(),
            "trace": _trace(state, "critic", "done",
                            passed=crit.passed, score=crit.score, issues=len(crit.issues))}
```
- `_assemble_full(state)` — calls the assembly helper from above to build a complete `Script`
  (title + characters + sorted scenes, with the mood-cleaning guard already applied) purely so
  the critic agent has something whole to read and judge — this `Script` object is **not**
  stored anywhere in state at this point; it's constructed fresh, used for this one call, and
  discarded (the *final* `Script` gets reassembled again, redundantly but cheaply, in
  `n_finalize` below).

```python
def n_finalize(state: ScriptState) -> dict:
    script = _assemble_full(state)
    passed = state.get("critique", {}).get("passed", False)
    return {"script": script.model_dump(), "converged": passed,
            "trace": _trace(state, "finalize", "done", converged=passed)}
```
- `state.get("critique", {}).get("passed", False)` — **chained `.get()` calls with defaults at
  every level**: `state.get("critique", {})` returns the critique dict, or an empty dict `{}` if
  there isn't one at all (which would happen only if `finalize` were somehow reached without a
  critic ever running — defensive, not expected in normal flow); `.get("passed", False)` then
  reads the `passed` key from *that* (possibly empty) dict, defaulting to `False` if it's
  missing. This double-default chain means the line can never raise a `KeyError` regardless of
  what's actually in `state["critique"]` (or whether the key exists at all) — a purely defensive
  read, since the meaningful value being computed (`converged`, surfaced to the client) should
  degrade to "not converged" rather than crash if anything upstream is in an unexpected shape.
- No LLM call in this node at all — purely assembling and labeling already-computed data; this
  is the "system" kind of node referenced in the pipeline's visual diagram (vs. "agent" nodes
  that call Gemini).

```python
# regeneration nodes (single focused agent call, canon locked) --------------
def n_regen_scene(state: ScriptState) -> dict:
    script = Script.model_validate(state["canon_script"])
    idx = int(state["target_index"])
    new = regen_scene(get_client(), state["voice_system"], state["request_id"], script, idx, state.get("note"))
    scenes = [new if s.scene_index == idx else s for s in script.scenes]
    if all(s.scene_index != idx for s in script.scenes):
        scenes.append(new)
    script.scenes = sorted(scenes, key=lambda s: s.scene_index)
    return {"script": script.model_dump(), "trace": _trace(state, "regen_scene", "done", index=idx)}
```
- `script = Script.model_validate(state["canon_script"])` — rebuilds the full `Script` object
  from the dict the client round-tripped back to the server (§4.2 in `INTERVIEW_PREP.md`'s
  "no server-side persistence" design, made concrete here).
- `idx = int(state["target_index"])` — explicit `int(...)` conversion; `target_index` arrives
  through `RegenTarget.index: Optional[int]` (already validated as an int-or-None by Pydantic
  at the API boundary), so this is mostly a defensive type-certainty measure rather than
  correcting a real type mismatch.
- `new = regen_scene(...)` — calls the agent function from `agents.py`, getting back a single
  freshly-rewritten `Scene`.
- `scenes = [new if s.scene_index == idx else s for s in script.scenes]` — a list comprehension
  with an inline conditional **inside** the expression part (not the filter part): for every
  existing scene `s`, keep it as-is **unless** its index matches the target, in which case
  substitute `new` in its place — this rebuilds the *entire* scenes list, in original order,
  with exactly one scene swapped out.
- `if all(s.scene_index != idx for s in script.scenes): scenes.append(new)` — `all(...)` over a
  generator expression is `True` only if *every* scene's index differs from `idx` — i.e., no
  scene at that index existed in the original list at all (the "create a new scene at this
  index" case from `agents.regen_scene`'s prompt-building logic, handled here on the code side):
  if so, the substitution above did nothing (there was nothing to replace), so the new scene is
  explicitly appended instead.
- `script.scenes = sorted(scenes, key=lambda s: s.scene_index)` — re-sorts by index (in case the
  newly-appended scene, for a previously-nonexistent index, needs to be slotted into its correct
  position rather than left at the end of the list) and reassigns it back onto the `script`
  object — note this **mutates** the local `script` object directly (`Script` is a regular
  Pydantic `BaseModel`, and direct attribute assignment is allowed unless the model is
  explicitly configured immutable, which this one isn't) — fine here since `script` is a
  throwaway local object reconstructed fresh from `state["canon_script"]` at the top of this
  same function call, not a shared/cached instance.

```python
def n_regen_dialogue(state: ScriptState) -> dict:
    script = Script.model_validate(state["canon_script"])
    idx = int(state["target_index"])
    out = regen_dialogue(get_client(), state["voice_system"], state["request_id"], script, idx, state.get("note"))
    for s in script.scenes:
        if s.scene_index == idx:
            s.dialogue = out.dialogue
    return {"script": script.model_dump(), "trace": _trace(state, "regen_dialogue", "done", index=idx)}
```
- A plain `for` loop with an `if` inside, rather than a comprehension — chosen here because the
  action is a **mutation** (`s.dialogue = out.dialogue`, reassigning an attribute on an existing
  `Scene` object found by matching index) rather than building a new list, which doesn't map
  naturally onto a comprehension (comprehensions are for *constructing* a new collection, not
  for side-effecting existing objects) — a good example of picking the right looping construct
  for what's actually being done, rather than forcing a comprehension everywhere for brevity.

```python
def n_regen_meta(state: ScriptState) -> dict:
    script = Script.model_validate(state["canon_script"])
    meta = regen_meta(get_client(), state["voice_system"], state["request_id"], script, state.get("note"))
    script.movie_title, script.tagline, script.logline = meta.movie_title, meta.tagline, meta.logline
    return {"script": script.model_dump(), "trace": _trace(state, "regen_meta", "done")}


def n_regen_characters(state: ScriptState) -> dict:
    script = Script.model_validate(state["canon_script"])
    out = regen_characters(get_client(), state["voice_system"], state["request_id"], script, state.get("note"))
    script.characters = out.characters
    return {"script": script.model_dump(), "trace": _trace(state, "regen_characters", "done")}
```
- `script.movie_title, script.tagline, script.logline = meta.movie_title, meta.tagline,
  meta.logline` — tuple assignment again (see glossary), updating three attributes on the
  `Script` object in one statement from the three corresponding fields of the `MetaOut` result.
- `n_regen_characters` swaps the whole `characters` list wholesale — there's no per-character
  matching/merging logic needed here (unlike `n_regen_scene`'s index-matching), since
  `regen_characters` always returns a complete replacement roster, not a single character.

```python
# ----------------------------------------------------------------- routing
def route_dispatch(state: ScriptState) -> str:
    return {
        "full": "architect",
        "regen_scene": "regen_scene",
        "regen_dialogue": "regen_dialogue",
        "regen_meta": "regen_meta",
        "regen_characters": "regen_characters",
    }.get(state.get("mode", "full"), "architect")
```
- A **routing function**: given the current state, returns the *name* of the next node to go
  to — this is what LangGraph calls a "conditional edge" function.
- `{...}.get(state.get("mode", "full"), "architect")` — builds a dict literal mapping each
  possible `mode` string to its destination node name, then immediately looks up the current
  mode in it via `.get(key, default)`. The outer `.get(..., "architect")`'s default
  (`"architect"`) only matters if `state["mode"]` somehow holds a string that isn't one of the
  five known keys — defensive fallback to the full-generation path in that unexpected case.

```python
def route_after_critic(state: ScriptState) -> str:
    crit = state.get("critique", {})
    if crit.get("passed"):
        return "finalize"
    if state.get("iteration", 1) > settings.max_iterations:   # loop guard -> best effort
        return "finalize"
    return "revise"
```
- The function deciding whether to loop back to the screenwriter or move on — implements
  exactly the three-way logic described in §4.1 of `INTERVIEW_PREP.md`: passed → finalize;
  budget exhausted → finalize anyway (best-effort); otherwise → revise (loop).
- `state.get("iteration", 1)` — defaults to `1` (not `0`) here specifically; since this function
  is only ever called *after* `n_screenwriter` has already run at least once (incrementing
  `iteration` to at least `1`), defaulting to `1` is a defensive value consistent with "we must
  have done at least one pass to get here," rather than `0`, which would incorrectly suggest no
  pass had happened yet.
- `> settings.max_iterations` — with the default `max_iterations = 2`, this becomes `iteration >
  2`, i.e. revision is allowed after pass 1 and pass 2, but a third revision (which would require
  `iteration` to reach 3) is blocked — meaning at most 2 *screenwriter* passes can happen if the
  critic never passes (1 initial + 1 revision), since by the time `iteration == 2` and the
  critic still hasn't passed, the *next* check (`2 > 2` is `False`) actually still allows one
  more revision loop... — worth tracing through carefully if asked: `iteration` starts at 0,
  becomes 1 after the first screenwriter pass; if critic fails, `1 > 2` is `False` → revise
  (second screenwriter pass, `iteration` becomes 2); if critic fails again, `2 > 2` is `False` →
  revise again (third screenwriter pass, `iteration` becomes 3); if critic fails a third time,
  `3 > 2` is `True` → finalize. So with `max_iterations = 2`, the screenwriter can actually run
  up to **3** times total (1 original + 2 revisions) before the loop guard forces a stop — the
  name `max_iterations` really means "max additional revision passes allowed," not "max total
  screenwriter calls."

```python
# ----------------------------------------------------------------- build graph
def _build():
    g = StateGraph(ScriptState)
    g.add_node("dispatch", n_dispatch)
    g.add_node("architect", n_architect)
    g.add_node("screenwriter", n_screenwriter)
    g.add_node("critic", n_critic)
    g.add_node("finalize", n_finalize)
    g.add_node("regen_scene", n_regen_scene)
    g.add_node("regen_dialogue", n_regen_dialogue)
    g.add_node("regen_meta", n_regen_meta)
    g.add_node("regen_characters", n_regen_characters)
```
- `StateGraph(ScriptState)` — constructs a new graph builder, **parameterized by the
  `ScriptState` TypedDict** — this is purely for LangGraph's own internal typing/validation of
  what shape of dict nodes are allowed to read/return; it doesn't change runtime behavior beyond
  that.
- `g.add_node("dispatch", n_dispatch)` — registers a node under the string name `"dispatch"`,
  associated with the function `n_dispatch`. The string name is what shows up in `trace`
  entries, in `route_dispatch`'s return values, and in the `PIPELINE_GRAPH` static description
  below — note the **convention** in this codebase: node *functions* are prefixed `n_` (e.g.
  `n_dispatch`), while the *registered names* drop that prefix (`"dispatch"`) — purely a naming
  convention to avoid name collisions between the Python function and the graph's string
  identifier for it.

```python
    g.add_edge(START, "dispatch")
    g.add_conditional_edges("dispatch", route_dispatch, {
        "architect": "architect",
        "regen_scene": "regen_scene",
        "regen_dialogue": "regen_dialogue",
        "regen_meta": "regen_meta",
        "regen_characters": "regen_characters",
    })
    g.add_edge("architect", "screenwriter")
    g.add_edge("screenwriter", "critic")
    g.add_conditional_edges("critic", route_after_critic,
                            {"revise": "screenwriter", "finalize": "finalize"})
    for node in ("finalize", "regen_scene", "regen_dialogue", "regen_meta", "regen_characters"):
        g.add_edge(node, END)
    return g.compile()
```
- `g.add_edge(START, "dispatch")` — a **fixed**, unconditional edge: the graph always starts at
  `dispatch`, no decision involved.
- `g.add_conditional_edges("dispatch", route_dispatch, {...})` — registers a **branching** edge:
  after `dispatch` runs, call `route_dispatch(state)` to get a string, then look that string up
  in the provided mapping dict to find which node to actually go to next. The mapping dict here
  is mapping `route_dispatch`'s possible return values (`"architect"`, `"regen_scene"`, etc.) to
  actual node names — in this particular case they happen to be identical strings, but the
  mapping is still required by LangGraph's API (the *return value* of a routing function and the
  *node name* are conceptually distinct things, even when they're spelled the same).
- `g.add_edge("architect", "screenwriter")` / `g.add_edge("screenwriter", "critic")` — fixed
  edges forming the straight-line part of the full-generation flow.
- `g.add_conditional_edges("critic", route_after_critic, {"revise": "screenwriter", "finalize":
  "finalize"})` — this is the actual loop: `route_after_critic` can return `"revise"`, which maps
  to going back to the **already-visited** `"screenwriter"` node — the mapping dict pointing a
  route name back to an earlier node is what makes this a cycle in the graph, not the function
  logic itself.
- `for node in (...): g.add_edge(node, END)` — a loop (over a tuple literal) registering the
  same kind of edge — "this node leads straight to the graph's end" — for five different nodes
  at once, rather than five repeated `add_edge(..., END)` lines.
- `return g.compile()` — turns the declared nodes/edges into an actual runnable graph object
  (validates the structure, e.g. that every conditional edge's possible destinations are real
  registered nodes) — this is the object that has `.invoke()` and `.stream()` methods used
  elsewhere.

```python
GRAPH = _build()
```
- Module-level: the graph is built **once**, at import time, and reused for every request
  (`GRAPH.invoke(...)` / `GRAPH.stream(...)` are called repeatedly against this same compiled
  object) — building the graph itself (declaring nodes/edges) is cheap and has no per-request
  state baked into it (`ScriptState` instances are created fresh per call, never stored on the
  graph object), so a singleton graph is perfectly safe to share across concurrent requests.

```python
# static description of the pipeline, for the UI to draw the agent graph
PIPELINE_GRAPH = {
    "nodes": [
        {"id": "dispatch", "label": "Dispatch", "kind": "router"},
        {"id": "architect", "label": "Architect", "kind": "agent"},
        {"id": "screenwriter", "label": "Screenwriter", "kind": "agent"},
        {"id": "critic", "label": "Script Doctor", "kind": "agent"},
        {"id": "finalize", "label": "Finalize", "kind": "system"},
    ],
    "edges": [
        {"from": "dispatch", "to": "architect"},
        {"from": "architect", "to": "screenwriter"},
        {"from": "screenwriter", "to": "critic"},
        {"from": "critic", "to": "screenwriter", "label": "revise (loop)"},
        {"from": "critic", "to": "finalize", "label": "pass / max-iters"},
    ],
}
```
- A **plain Python dict literal**, entirely separate from the actual compiled `GRAPH` object
  above — this isn't introspected from `GRAPH` programmatically; it's hand-written to describe
  (a simplified version of — note the regen nodes are intentionally omitted, since the UI graph
  visualization is specifically about the full-generation flow a user watches live) the same
  structure, for the frontend to render as a static diagram (the `/api/pipeline` endpoint in
  `main.py` just returns this dict as JSON directly). Keeping it hand-written, separate data
  means it can be deliberately *simplified* for display purposes (no regen branches cluttering
  the visual) without needing to filter/transform the real graph object at request time.

```python
# ----------------------------------------------------------------- run helpers
def _final_meta(state: dict) -> dict:
    crit = state.get("critique", {})
    return {
        "request_id": state.get("request_id"),
        "mode": state.get("mode", "full"),
        "converged": state.get("converged", True),
        "score": crit.get("score"),
        "iterations": state.get("iteration"),
        "situation": state.get("situation"),
        "mood": state.get("mood"),
        "director": state.get("director"),
        "trace": state.get("trace", []),
    }
```
- Builds the `meta` dict returned to the API caller — note `"converged": state.get("converged",
  True)` defaults to `True` if the key's absent, which is actually correct for the
  **regeneration** branch: regen modes never go through the critic loop at all (there's no
  `converged` key ever set for them), and a regen result genuinely has no "did it converge"
  concept to report — defaulting to `True` here effectively means "convergence is meaningless/
  trivially satisfied for this mode," rather than misleadingly reporting `False`.

```python
def run(initial: ScriptState) -> tuple[Script, dict]:
    """Run the graph to completion and return (Script, meta). Graceful on agent failure."""
    rid = initial.get("request_id", "?")
    try:
        out = GRAPH.invoke(initial)
    except AgentError as exc:
        log_event(rid, "pipeline", "agent_error", error=str(exc))
        raise
    if "script" not in out:
        raise AgentError("pipeline finished without producing a script")
    return Script.model_validate(out["script"]), _final_meta(out)
```
- `GRAPH.invoke(initial)` — runs the **entire** graph synchronously to completion (as opposed to
  `.stream()` below, which yields incrementally) — used by the plain `POST /api/generate` and
  `POST /api/regenerate` endpoints in `main.py`, which don't need live progress, just the final
  result.
- `except AgentError as exc: log_event(...); raise` — note this **doesn't swallow** the
  exception; it logs an extra top-level "an agent ultimately failed" record (in addition to
  whatever was already logged at the point of failure inside `client.py`) and then `raise`s it
  again unmodified (a bare `raise` inside an `except` block re-raises the exact same exception
  object that was just caught) — this is "log for visibility, then let the caller (`main.py`)
  decide what HTTP response to send," not "handle and hide" the error.
- `if "script" not in out: raise AgentError(...)` — a final sanity check: if the graph somehow
  completed without ever reaching a node that sets `script` in state (shouldn't happen given the
  graph's structure — every path eventually leads through `finalize` or a regen node, both of
  which always set `script` — but defensive nonetheless), raise an explicit, clearly-worded
  error rather than letting the next line fail with a confusing `KeyError`.
- `return Script.model_validate(out["script"]), _final_meta(out)` — returns a 2-tuple: the final
  dict→object round-trip for the script, alongside the computed meta dict.

```python
def stream(initial: ScriptState):
    """Yield (node_name, partial_state) per completed node — powers live SSE visualization."""
    for chunk in GRAPH.stream(initial):
        for node_name, partial in chunk.items():
            yield node_name, partial
```
- `GRAPH.stream(initial)` — LangGraph's incremental execution API: rather than running to
  completion and returning once, this returns an iterator that yields a **chunk** after every
  node finishes. Each chunk is itself a dict shaped like `{node_name: partial_state_dict}` —
  normally with exactly one key (the node that just completed), since LangGraph executes nodes
  one at a time along the path this graph takes (no parallel/fan-out node execution is used
  here).
- `for chunk in GRAPH.stream(initial): for node_name, partial in chunk.items(): yield node_name,
  partial` — a nested loop: the outer loop receives each chunk as it becomes available (this is
  itself lazy — `GRAPH.stream()` is a generator, so each chunk is only produced, and this
  function's outer loop only advances, once the corresponding node has actually finished
  running); the inner loop unpacks that single-key dict into a `(node_name, partial)` tuple via
  `.items()` and `yield`s it onward. Because `stream()` itself uses `yield` (making it a
  generator), calling `stream(initial)` doesn't run *any* of the pipeline immediately — the
  whole pipeline only actually executes as something iterates this generator (e.g. the `for
  node, partial in stream(initial):` loops seen in `main.py`'s SSE and WebSocket handlers) —
  this laziness is exactly what allows each step to be forwarded to the browser the instant it's
  produced, rather than only after the entire generation finishes.

---

## 9. `backend/app/observability/logger.py` — structured logging

```python
"""Observability: log every prompt and raw response, keyed by request_id + agent.
...
"""
from __future__ import annotations

import json
import threading
import time

from app.config import settings

_lock = threading.Lock()
```
- `_lock = threading.Lock()` — a **module-level** lock, shared by every call to `log_event`
  across the whole process (unlike `RateLimiter`'s lock, which is per-instance) — appropriate
  here since there's exactly one log file per day and writes to it must be serialized regardless
  of which request/thread/agent is doing the writing, to avoid interleaved/corrupted lines.

```python
def _logfile():
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    return settings.log_dir / (time.strftime("%Y-%m-%d") + ".jsonl")
```
- `settings.log_dir.mkdir(parents=True, exist_ok=True)` — `Path.mkdir`: creates the logs
  directory if it doesn't exist. `parents=True` means create any missing intermediate
  directories too (not just the final one); `exist_ok=True` means don't raise an error if the
  directory already exists (without it, calling `.mkdir()` on an already-existing directory
  raises `FileExistsError`) — this runs on **every** log call (not just once at startup), which
  is slightly redundant after the first time but cheap and robust against the directory being
  deleted mid-run.
- `settings.log_dir / (time.strftime("%Y-%m-%d") + ".jsonl")` — builds today's log file path,
  e.g. `backend/logs/2026-06-24.jsonl` — a **new file per calendar day**, computed fresh on
  every call (so logging automatically rolls over to a new file right when the date changes,
  with no explicit rollover logic needed — it falls naturally out of recomputing the filename
  from the current date every time).

```python
def _short(v, n: int = 240):
    if isinstance(v, str) and len(v) > n:
        return v[:n] + f"… (+{len(v) - n} chars)"
    return v
```
- `isinstance(v, str) and len(v) > n` — only truncates if `v` is actually a string (other types
  — ints, bools, lists — are returned untouched) **and** it's longer than the threshold.
- `v[:n] + f"… (+{len(v) - n} chars)"` — keeps the first `n` characters, appends an ellipsis and
  a note of exactly how many characters were cut, so the console preview (see below) stays
  readable while still telling you *something* was hidden, and how much.
- This function is used **only** for the short console preview, never for what's written to the
  `.jsonl` file — the file always gets the complete, untruncated data.

```python
def log_event(request_id: str, agent: str, event: str, **data) -> None:
    """Append a full structured record to the daily log and print a short console line."""
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "request_id": request_id,
        "agent": agent,
        "event": event,
        **data,
    }
    line = json.dumps(rec, ensure_ascii=False, default=str)
```
- `**data` — gathers any extra keyword arguments (`system=..., user=..., raw=..., thoughts=...,
  latency_s=...`, etc., varying by call site) into a dict, exactly as in `pipeline.py`'s
  `_trace`.
- `rec = {..., **data}` — same dict-merge-via-unpacking pattern: the four fixed fields plus
  whatever call-specific fields were passed, combined into one record dict.
- `json.dumps(rec, ensure_ascii=False, default=str)` — `ensure_ascii=False` means non-ASCII
  characters (crucially, **the Hinglish/Devanagari-adjacent Romanized text and any literal
  Hindi script the model might produce**) are written as actual UTF-8 characters in the log
  file rather than being escaped into `\uXXXX` sequences — much more readable when inspecting
  logs by eye. `default=str` tells `json.dumps` "if you encounter any object you don't know how
  to serialize natively (not a dict/list/str/int/float/bool/None), just call `str()` on it" — a
  safety net against a future call site accidentally passing something like a raw exception
  object or a non-JSON-native type as one of the `**data` values, ensuring `log_event` itself
  can never crash on a serialization error no matter what gets passed to it.

```python
    try:
        with _lock:
            with open(_logfile(), "a", encoding="utf-8") as f:
                f.write(line + "\n")
    except Exception as exc:  # logging must never crash the request
        print(f"[logger error] {exc}")
```
- `with _lock:` then a nested `with open(..., "a", encoding="utf-8") as f:` — two nested context
  managers: the outer one holds the lock for the duration of the file write (serializing
  concurrent writers); the inner one opens the file in **append mode** (`"a"` — writes go to the
  end of the file, the file is created if it doesn't exist yet) and guarantees it's closed
  afterward even if `.write()` raises.
- `f.write(line + "\n")` — writes the JSON line plus a newline, making the file valid **JSON
  Lines** format (one complete JSON object per line — a deliberate choice over one giant JSON
  array, since it means the file can be appended to forever without ever needing to parse/
  rewrite the whole existing file, and can be tailed/streamed/grepped line by line).
- `except Exception as exc: print(f"[logger error] {exc}")` — the inline comment states the
  principle directly: **logging is explicitly not allowed to be a point of failure for the
  actual request**. If writing to disk fails for any reason (permissions, disk full, the
  directory got deleted mid-run), the failure is swallowed and just printed to the console
  instead of propagating up and potentially crashing or corrupting an in-progress agent call —
  observability should never become a reason the product itself breaks.

```python
    preview = {k: _short(v) for k, v in data.items()}
    print(f"[{rec['ts']}] {request_id[:8]} {agent}/{event} {preview}")
```
- `{k: _short(v) for k, v in data.items()}` — a **dict comprehension** (the `{key: value for
  ...}` form, distinct from the list comprehensions seen elsewhere): builds a new dict with the
  same keys as `data` but every value passed through `_short()` — so long fields (full prompts,
  full raw responses) get truncated for the console line specifically, while the full version
  was already durably written to the log file above, unaffected by this truncation.
- `request_id[:8]` — only the first 8 characters of the (32-character hex) request id, just
  enough to visually distinguish concurrent requests in console output without cluttering every
  line with a full UUID.
- This `print(...)` runs **unconditionally**, after the `try/except` block — note it's outside
  the `try`, so even if the file write failed and was caught above, the console preview line
  still gets printed regardless (the two are independent concerns: "did we persist this to disk"
  vs. "did we show a live developer-facing console line").

---

## 10. `backend/app/main.py` — the FastAPI surface

```python
"""FastAPI surface for the AI Bollywood Script Generator.
...
"""
from __future__ import annotations

import asyncio
import json
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.graph.pipeline import PIPELINE_GRAPH, _final_meta, run, stream
from app.llm.client import AgentError
from app.llm.rate_limiter import RateLimitExceeded
from app.prompts_loader import list_directors, list_moods, pretty
from app.schemas import GenerateRequest, GenerateResponse, RegenerateRequest
```
- `import asyncio` — used for the WebSocket bridge (`asyncio.get_running_loop`,
  `asyncio.Queue`, `asyncio.create_task`, `asyncio.to_thread`), all explained in detail below.
- `import uuid` — `uuid.uuid4().hex` generates a random unique id (used as each request's
  `request_id`).
- `from app.graph.pipeline import PIPELINE_GRAPH, _final_meta, run, stream` — note this imports
  `_final_meta`, a **name prefixed with an underscore** (a "private" convention, per the
  glossary) from another module — Python doesn't actually prevent this (the underscore is just a
  convention, not an enforced access modifier), and it's done deliberately here because `main.py`
  needs to compute the same `meta` shape mid-stream (inside the WebSocket/SSE handlers, using a
  `merged` dict that isn't the graph's true final output) as `run()` computes at the very end —
  reusing the private helper avoids duplicating that logic, at the cost of slightly blurring the
  module's public/private boundary.

```python
app = FastAPI(title="AI Bollywood Script Generator", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)
```
- `app = FastAPI(...)` — the actual application object; `title`/`version` show up in the
  auto-generated OpenAPI docs at `/docs`.
- `app.add_middleware(CORSMiddleware, ...)` — registers CORS handling globally, using
  `settings.cors_origins` (`["*"]`, per `config.py`) and allowing every HTTP method and every
  request header from any origin — this is what lets the browser-hosted frontend (a different
  origin from the Cloud Run backend) successfully make `fetch`/WebSocket calls to it at all;
  without this middleware, browsers would block the cross-origin requests by default.

```python
# Serve director photos (top-level directors/<id>.jpg) for the UI selector.
if settings.director_images_dir.exists():
    app.mount(
        "/assets/directors",
        StaticFiles(directory=str(settings.director_images_dir)),
        name="director_images",
    )
```
- `if settings.director_images_dir.exists():` — only mounts the static file route at all if that
  directory actually exists on disk — guards against a deployment/environment where the
  `directors/` photo folder wasn't included, in which case the app still starts fine, just
  without serving director images (rather than crashing at startup trying to mount a
  nonexistent directory).
- `app.mount("/assets/directors", StaticFiles(...), name="director_images")` — `.mount()`
  attaches an entire sub-application (here, FastAPI's built-in static file server) under a URL
  prefix — any request to `/assets/directors/<anything>` is handled by serving the matching file
  from `settings.director_images_dir`, without needing a hand-written route for each possible
  filename.

```python
_IMG_EXTS = ("jpg", "jpeg", "png", "webp", "avif")


def _director_image(did: str) -> str | None:
    for ext in _IMG_EXTS:
        if (settings.director_images_dir / f"{did}.{ext}").exists():
            return f"/assets/directors/{did}.{ext}"
    return None
```
- `_IMG_EXTS = (...)` — a tuple of acceptable image extensions, checked in this specific order
  (so if multiple extensions exist for the same id, e.g. both a `.jpg` and a `.png`, the `.jpg`
  one wins, since it's checked first and the function returns immediately on the first match).
- `for ext in _IMG_EXTS: if (...).exists(): return ...` — tries each extension in turn, building
  the candidate file path and checking it on disk; returns the **URL path** (not the filesystem
  path) the moment a match is found.
- `return None` — if no file with any of the known extensions exists for this director id, there
  simply is no photo for them (handled gracefully downstream — `Options` schema's `image` field
  is `Optional`).

```python
_TARGET_TO_MODE = {
    "title": "regen_meta", "tagline": "regen_meta", "meta": "regen_meta",
    "scene": "regen_scene", "dialogue": "regen_dialogue", "characters": "regen_characters",
}
```
- A lookup table mapping the client-facing `RegenTarget.type` values to the internal graph
  `mode` strings `n_dispatch`'s routing understands. Note **three different target types**
  (`"title"`, `"tagline"`, `"meta"`) all map to the **same** `"regen_meta"` mode — because, per
  `agents.regen_meta`, title/tagline/logline are always regenerated together as one unit; the
  API just exposes three semantically distinct buttons to the user ("regenerate title" vs.
  "regenerate tagline") for a clearer UI, even though under the hood they trigger the identical
  backend behavior.

```python
def _err(status: int, kind: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": message, "kind": kind})
```
- A small helper used by every endpoint's exception handling, ensuring **every** error response
  across the whole API has the exact same shape (`ok: false`, an `error` message, and a `kind`
  classification) — this consistency is what the frontend's `parseError()` (in `api.ts`) relies
  on to extract `message`/`kind` uniformly regardless of which endpoint or failure path produced
  the error.

```python
# --------------------------------------------------------------- meta endpoints
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model": settings.gemini_model,
        "has_api_key": bool(settings.gemini_api_key),
        "moods": len(list_moods()),
        "directors": len(list_directors()),
    }
```
- `@app.get("/api/health")` — registers this function to handle `GET /api/health`.
- `def health():` — a **synchronous** (not `async def`) endpoint function; FastAPI automatically
  runs sync endpoint functions in a thread pool behind the scenes, so this is fine even though
  it's not natively async — appropriate here since nothing in this function actually does
  blocking I/O worth worrying about (it's all fast in-memory checks and cheap file globs).
- `bool(settings.gemini_api_key)` — converts the key string to a boolean presence check —
  **the key's actual value is never returned**, only whether one is configured at all; this is
  deliberately safe to expose publicly (it doesn't leak the secret, just confirms the deployment
  is configured) and was specifically checked during the security audit described in
  `INTERVIEW_PREP.md`.
- `len(list_moods())`, `len(list_directors())` — just counts, used as a quick sanity check that
  the prompt library files are present and discoverable in this deployment (if these came back
  `0`, that would indicate the `prompts/` directory wasn't deployed correctly, for instance).

```python
@app.get("/api/options")
def options():
    return {
        "moods": [{"id": m, "label": pretty(m)} for m in list_moods()],
        "directors": [
            {"id": d, "label": pretty(d), "image": _director_image(d)}
            for d in list_directors()
        ],
    }
```
- Two list comprehensions building the exact `Options` shape (`{moods: Option[], directors:
  DirectorOption[]}`) the frontend's `useOptions` hook expects — each mood/director id paired
  with its pretty display label (and, for directors, an optional photo URL).

```python
@app.get("/api/pipeline")
def pipeline():
    return PIPELINE_GRAPH
```
- Just returns the hand-written static dict from `pipeline.py` directly as JSON — FastAPI
  automatically serializes a returned plain dict to a JSON response; no explicit
  `JSONResponse(...)` wrapping needed for the simple success case (it's only used explicitly in
  `_err()` above because that needs a non-200 status code, which the default dict-return
  shortcut doesn't support).

```python
# --------------------------------------------------------------- generation
def _generate_state(req: GenerateRequest) -> dict:
    return {
        "request_id": uuid.uuid4().hex,
        "mode": "full",
        "situation": req.situation,
        "mood": req.mood,
        "director": req.director,
        "characters_hint": req.characters_hint,
        "trace": [],
    }
```
- `uuid.uuid4().hex` — `uuid4()` generates a random 128-bit identifier (not based on any
  predictable input like time or MAC address, unlike `uuid1`); `.hex` renders it as a plain
  32-character lowercase hex string (no dashes) — used as every request's unique
  `request_id`, threaded through the graph and into every log line.
- This helper builds the **initial** `ScriptState` dict for a full generation — note `"trace":
  []` starts as an explicit empty list (rather than leaving the key absent and relying on
  `_trace`'s `.get("trace", [])` default) — both would actually work given `_trace`'s defensive
  `.get(..., [])`, but initializing it explicitly here documents the intent clearly at the
  state's construction site.

```python
@app.post("/api/generate", response_model=GenerateResponse)
def generate(req: GenerateRequest):
    try:
        script, meta = run(_generate_state(req))
        return GenerateResponse(script=script, meta={**meta, "title": script.movie_title})
    except RateLimitExceeded as exc:
        return _err(429, "rate_limit", str(exc))
    except AgentError as exc:
        return _err(502, "agent", str(exc))
    except Exception as exc:  # noqa: BLE001 - last-resort graceful failure
        return _err(500, "server", f"{type(exc).__name__}: {exc}")
```
- `@app.post("/api/generate", response_model=GenerateResponse)` — `response_model=...` tells
  FastAPI the expected **success** response shape; it uses this to validate/serialize the
  return value and to generate accurate OpenAPI documentation — note this only describes the
  happy path's shape; the `_err(...)` calls below return a differently-shaped `JSONResponse`
  directly, which FastAPI allows (a route can return either the declared `response_model` type
  *or* a `Response` subclass like `JSONResponse`, bypassing the model on that path).
- `req: GenerateRequest` as the parameter — FastAPI automatically parses and validates the
  incoming JSON request body against the `GenerateRequest` Pydantic model, rejecting malformed
  requests with a `422` automatically, *before* this function body even runs — none of that
  validation logic is hand-written here, it's inherited entirely from declaring the parameter's
  type.
- `script, meta = run(_generate_state(req))` — tuple unpacking the 2-tuple `run()` returns.
- `meta={**meta, "title": script.movie_title}` — dict-merge-with-override: takes everything from
  the `meta` dict `run()` computed, and adds (or overrides) a `title` key with the script's
  actual title — convenient for the frontend to have the title readily available in `meta`
  without needing to dig into `script.movie_title` itself for things like labeling a history
  entry.
- Three `except` clauses, each catching a progressively more general exception type, each
  mapped to a specific HTTP status and `kind` — exactly the error-handling taxonomy from §10 of
  `INTERVIEW_PREP.md`, written out concretely: `RateLimitExceeded` → `429`, `AgentError` → `502`,
  anything else at all → `500` as the final, last-resort catch-all (with the `# noqa: BLE001`
  comment again explicitly flagging "yes, this bare `except Exception` is intentional").
- `f"{type(exc).__name__}: {exc}"` — formats the *type name* of whatever unexpected exception
  was caught (e.g. `"ValueError"`, `"KeyError"`) alongside its message — gives the client (and
  the logs, since this string ends up in the JSON error response) more diagnostic information
  than the bare message alone would, for the genuinely-unanticipated failure case.

```python
def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, default=str)}\n\n"
```
- Formats a Python dict into the **Server-Sent Events wire format**: the literal text `data: `,
  followed by the JSON payload, followed by **two** newlines (`\n\n`) — SSE's spec requires a
  blank line to terminate each event; a single `\n` would not correctly delimit one event from
  the next.

```python
@app.post("/api/generate/stream")
def generate_stream(req: GenerateRequest):
    """Stream per-agent events as the graph runs, then the final result (SSE)."""
    initial = _generate_state(req)
    merged = dict(initial)

    def gen():
        try:
            for node, partial in stream(initial):
                merged.update(partial)
                last = (partial.get("trace") or [{}])[-1]
                yield _sse({"type": "step", "node": node, "trace": last})
            script = merged.get("script")
            meta = _final_meta(merged)
            if script:
                meta["title"] = script.get("movie_title")
            yield _sse({"type": "result", "script": script, "meta": meta})
        except RateLimitExceeded as exc:
            yield _sse({"type": "error", "kind": "rate_limit", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            yield _sse({"type": "error", "kind": "agent", "error": f"{type(exc).__name__}: {exc}"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
```
- `merged = dict(initial)` — an explicit **copy** of the initial state dict (`dict(some_dict)`
  constructs a new, shallow-copied dict from an existing one) — `merged` is what gets
  progressively updated as nodes complete, while `initial` itself stays as the original
  unmodified starting state (which is actually re-passed into `stream(initial)` below — meaning
  `stream()` itself, internally, is the one tracking/threading the real evolving state through
  the graph; `merged` here in `main.py` is a **separate, parallel tracking copy** kept purely so
  this function can inspect partial progress (`merged.get("script")` after the loop) without
  needing the graph's internal final state object directly).
- `def gen():` — a **nested generator function**, defined inside the endpoint function — this
  is what `StreamingResponse` actually consumes; defining it inline like this lets it close over
  (capture) the enclosing function's local variables (`initial`, `merged`) without needing to
  pass them as explicit arguments.
- `for node, partial in stream(initial): merged.update(partial); ...` — iterates the pipeline's
  generator (§8.3 above), and for each completed node, merges its partial-state dict into
  `merged` (`dict.update()` overwrites/adds keys from the given dict into the dict it's called
  on, in place) — keeping `merged` as a running, ever-more-complete picture of the state.
- `last = (partial.get("trace") or [{}])[-1]` — `partial` is the dict a single node *just*
  returned (not the cumulative `merged`), so its `trace` field (if present) contains exactly one
  new entry appended onto whatever trace existed before (per `_trace`'s implementation) — but to
  be defensive, `partial.get("trace") or [{}]` falls back to a list containing one empty dict if
  `trace` is missing entirely (shouldn't happen, since every node always returns a `trace` key,
  but guards against an empty-list `or`-fallback issue: note `partial.get("trace")` returning an
  *empty* list `[]` is also falsy, so `or [{}]` would kick in for that case too) — then `[-1]`
  takes the **last** element of whatever list resulted, i.e. the newest trace entry, which is
  what actually gets sent to the browser as this step's `trace` payload.
- `yield _sse({"type": "step", "node": node, "trace": last})` — formats and yields one SSE
  event per completed node — each `yield` inside this generator function is what
  `StreamingResponse` flushes to the client as a chunk, in real time, while the generator is
  paused waiting for the *next* node in `stream(initial)` to finish (this is the streaming
  mechanism, mirrored later by the WebSocket version, except here using HTTP chunked transfer
  instead of WebSocket frames).
- After the `for` loop completes (the graph has finished — `stream()`'s underlying generator is
  exhausted): `script = merged.get("script")`, `meta = _final_meta(merged)` (reusing the
  pipeline's own meta-building helper, on this function's locally-tracked `merged` copy rather
  than the graph's own internal final output, since this code never gets direct access to that),
  conditionally adds `title` if a script exists, then yields one final `{"type": "result", ...}`
  event.
- `except RateLimitExceeded as exc: yield _sse({"type": "error", "kind": "rate_limit", ...})` /
  the broader `except Exception` below it — note these are **inside the generator function**,
  not around the call to `gen()` itself — because the actual pipeline execution only happens
  lazily, as the generator is iterated by `StreamingResponse` *after* this endpoint function has
  already returned, any exception from the pipeline can only meaningfully be caught from
  *within* the generator's own body, at the point where `stream(initial)` is actually being
  iterated — this is precisely why the streaming endpoints report errors as a special SSE/
  WebSocket *event* (`{"type": "error", ...}`) instead of as an HTTP error status code: by the
  time a mid-stream failure happens, the HTTP response has already started (with a `200` status
  already committed to the client), so there's no way to retroactively change the status code —
  the only option left is to signal failure through the data stream itself.
- `return StreamingResponse(gen(), media_type="text/event-stream", headers={...})` — wraps the
  generator in FastAPI's streaming response type, with the SSE-correct media type, and the three
  headers explained in `INTERVIEW_PREP.md` §8.1 aimed at discouraging proxy buffering (`Cache-
  Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`) — headers
  that, per the WebSocket section's own docstring elsewhere in this same file, ultimately
  weren't sufficient against Cloud Run's specific ingress behavior, which is why this endpoint
  is documented as being for local dev only, with the WebSocket endpoint below as what's
  actually used in production.

```python
@app.websocket("/api/generate/ws")
async def generate_ws(ws: WebSocket):
    """Live agent visualization over a WebSocket (the streaming transport that works).
    ...
    """
    await ws.accept()
    try:
        req = GenerateRequest.model_validate(await ws.receive_json())
    except Exception as exc:  # noqa: BLE001 - malformed first frame
        await ws.send_text(_ws_json({"type": "error", "kind": "bad_request",
                                     "error": f"invalid request: {exc}"}))
        await ws.close()
        return
```
- `@app.websocket("/api/generate/ws")` — a distinct FastAPI decorator (not `.get`/`.post`) for
  declaring a WebSocket route.
- `async def generate_ws(ws: WebSocket):` — WebSocket endpoints in FastAPI **must** be `async
  def` (unlike the sync `health()`/`options()` endpoints above) — the whole point of this
  endpoint is to stay responsive across a long-lived connection while awaiting events, which
  requires native async support, not the thread-pool trick FastAPI uses for sync HTTP endpoints.
- `await ws.accept()` — completes the WebSocket protocol upgrade handshake; the connection isn't
  usable for sending/receiving until this is called.
- `await ws.receive_json()` — awaits the **first** message the client sends (per the documented
  protocol: client connects, then immediately sends one JSON object), parses it as JSON, and
  returns the resulting Python dict/list/etc.
- `GenerateRequest.model_validate(await ws.receive_json())` — validates that received data
  against the `GenerateRequest` schema *manually* — unlike the HTTP endpoints, FastAPI's
  automatic request-body validation doesn't apply to WebSocket messages (there's no concept of
  a single "request body" for a socket), so this validation has to be invoked explicitly here.
- `except Exception as exc: await ws.send_text(...); await ws.close(); return` — if the first
  frame isn't valid JSON, or doesn't match the schema, send one explicit error event over the
  socket, close the connection, and `return` out of the whole endpoint function immediately —
  the rest of the function (everything below) never runs for this connection.

```python
    initial = _generate_state(req)
    merged = dict(initial)
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
```
- `loop = asyncio.get_running_loop()` — gets a reference to **the** event loop currently running
  this coroutine — needed because the worker thread (defined next) will need to safely hand data
  back to *this specific* event loop from a different thread, and `call_soon_threadsafe` (used
  below) is a method on the loop object itself, so a reference to it must be captured here, on
  the event-loop thread, before spawning the worker.
- `queue: asyncio.Queue = asyncio.Queue()` — an async-aware FIFO queue, used as the hand-off
  point between the worker thread (producer) and this coroutine (consumer) — explicitly
  type-annotated (`: asyncio.Queue`) even though the right-hand side already makes the type
  obvious, presumably for clarity/consistency with the rest of the typed codebase.

```python
    def worker():
        # Runs in a thread: the graph + Gemini calls are blocking, so we keep them off
        # the event loop and hand finished events back via the thread-safe queue.
        def emit(evt: dict) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, evt)
        try:
            for node, partial in stream(initial):
                merged.update(partial)
                last = (partial.get("trace") or [{}])[-1]
                emit({"type": "step", "node": node, "trace": last})
            script = merged.get("script")
            meta = _final_meta(merged)
            if script:
                meta["title"] = script.get("movie_title")
            emit({"type": "result", "script": script, "meta": meta})
        except RateLimitExceeded as exc:
            emit({"type": "error", "kind": "rate_limit", "error": str(exc)})
        except Exception as exc:  # noqa: BLE001
            emit({"type": "error", "kind": "agent", "error": f"{type(exc).__name__}: {exc}"})
        finally:
            emit(None)  # sentinel: worker is done
```
- `def worker():` — a plain (non-async) function — this is the function that will run on a
  **separate OS thread**, entirely outside the event loop, which is precisely why it's allowed
  to call the *blocking* `stream(initial)` generator (whose internal Gemini calls block on
  network I/O) without freezing anything else the server is doing.
- `def emit(evt: dict) -> None: loop.call_soon_threadsafe(queue.put_nowait, evt)` — a small
  nested helper, itself a closure over `loop` and `queue` from the enclosing scope.
  `loop.call_soon_threadsafe(callback, *args)` is the **one safe way** to interact with an
  asyncio event loop from a different thread: it schedules `callback(*args)` — here,
  `queue.put_nowait(evt)` — to run on the event loop's own thread, at its next opportunity,
  rather than calling `queue.put_nowait(evt)` directly from the worker thread (which would be
  unsafe — `asyncio.Queue` is not thread-safe on its own; it's designed to be used from a single
  event loop thread, and `call_soon_threadsafe` is the sanctioned bridge for crossing that
  boundary).
- The body of `worker()` is structurally **identical** to `generate_stream`'s `gen()` function
  above — same loop over `stream(initial)`, same `merged.update`/`last` extraction, same
  result/error event shapes — the only difference is calling `emit(...)` instead of `yield
  _sse(...)`, because this function can't `yield` directly back to the async consumer (it's not
  a generator the event loop is iterating; it's a thread running independently) — events have to
  be actively pushed across the thread boundary via the queue instead of pulled via iteration.
- `finally: emit(None)` — runs **no matter how** the `try` block exited — whether it completed
  normally after the result event, or exited early via one of the `except` clauses after an
  error event — guaranteeing exactly one `None` sentinel is always eventually emitted, which is
  what lets the consuming loop below know definitively "the worker thread is finished, stop
  waiting for more events" in every possible case.

```python
    task = asyncio.create_task(asyncio.to_thread(worker))
    try:
        while True:
            evt = await queue.get()
            if evt is None:
                break
            await ws.send_text(_ws_json(evt))
    except WebSocketDisconnect:
        pass  # client navigated away mid-generation; let the worker finish and discard
    finally:
        await task  # surface worker exceptions / ensure the thread is reaped
        try:
            await ws.close()
        except RuntimeError:
            pass  # already closed by the client
```
- `asyncio.to_thread(worker)` — schedules `worker` (the plain blocking function) to run in a
  thread-pool thread, returning an **awaitable** that completes when `worker()` returns (or
  raises whatever `worker()` raised, if it raised — though here `worker()` itself catches every
  exception internally via its own try/except, so in practice `asyncio.to_thread(worker)` should
  always complete normally).
- `task = asyncio.create_task(asyncio.to_thread(worker))` — wraps that awaitable in a `Task`,
  which schedules it to start running **immediately**, concurrently, without this coroutine
  needing to `await` it right away — this is what lets the function move on to the `while True`
  loop below *while the worker thread is simultaneously already running* the pipeline in the
  background.
- `while True: evt = await queue.get(); if evt is None: break; await ws.send_text(...)` — the
  consumer side: `await queue.get()` pauses this coroutine (without blocking the thread/event
  loop — other coroutines/connections can still be serviced while waiting) until the worker
  thread pushes something via `emit()`. Each non-`None` event is forwarded to the browser
  immediately via `await ws.send_text(...)`. The `None` sentinel breaks the loop — this is the
  exact mirror, on the receiving end, of the `finally: emit(None)` on the sending end.
- `except WebSocketDisconnect: pass` — if the **client** closes the connection (browser tab
  closed, navigated away) while this loop is still awaiting/sending, `ws.send_text` (or the
  underlying connection machinery) raises `WebSocketDisconnect` — caught here and simply
  ignored (`pass`) rather than letting it propagate as an unhandled error; the comment clarifies
  the worker thread is *not* cancelled when this happens — it keeps running to completion
  regardless (there's no cheap way to interrupt a thread mid-blocking-call in Python, and doing
  so isn't attempted here; the result is just computed and then discarded since there's no
  socket left to send it to).
- `finally: await task` — runs **regardless** of how the `try` block exited (normal completion
  via `break`, or the caught `WebSocketDisconnect`) — `await`-ing the task here ensures: (a) if
  the worker thread is still running (e.g. the client disconnected before the worker finished),
  this coroutine waits for it to actually finish before the endpoint function returns, so the
  thread is properly "reaped" rather than left dangling as an orphaned background thread after
  the connection's gone; (b) if `worker()` had somehow raised an exception that escaped its own
  internal try/except (not expected given how thoroughly that's wrapped, but theoretically
  possible), `await task` is what would surface that exception here, rather than it silently
  vanishing into an un-awaited task.
- `try: await ws.close() except RuntimeError: pass` — attempts a clean close of the socket;
  wrapped in its own try/except because calling `.close()` on a socket the **client** already
  closed first (the `WebSocketDisconnect` case above) raises a `RuntimeError` ("Cannot call
  \"close\" once a close message has been sent") — caught and ignored since the end state
  (socket closed) is the same either way; the comment notes plainly *why* this can happen
  ("already closed by the client").

```python
def _ws_json(obj: dict) -> str:
    return json.dumps(obj, default=str)
```
- Simpler than `_sse()` — no `data: `/`\n\n` framing needed, since WebSocket already has its own
  message framing at the protocol level; this just needs to turn the Python dict into a JSON
  text string to hand to `ws.send_text()`. `default=str` again as the safety net against any
  non-natively-serializable value sneaking into an event dict.

```python
# --------------------------------------------------------------- regeneration
@app.post("/api/regenerate", response_model=GenerateResponse)
def regenerate(req: RegenerateRequest):
    mode = _TARGET_TO_MODE.get(req.target.type)
    if mode is None:
        return _err(400, "bad_request", f"unknown target type: {req.target.type}")
    if req.target.type in ("scene", "dialogue") and req.target.index is None:
        return _err(400, "bad_request", f"target '{req.target.type}' requires an index")
```
- `mode = _TARGET_TO_MODE.get(req.target.type)` — looks up the mode; since `req.target.type` is
  already constrained by Pydantic's `Literal[...]` validation at the API boundary to be one of
  exactly six known strings (all of which *are* present as keys in `_TARGET_TO_MODE`), `mode is
  None` should be **unreachable** in practice — this check exists purely as defensive
  programming (the comment-free code itself signals "we don't actually expect this, but we
  handle it gracefully rather than assuming it can never happen").
- `if req.target.type in ("scene", "dialogue") and req.target.index is None:` — a check
  Pydantic's schema **cannot** express on its own: `RegenTarget.index: Optional[int] = None`
  is *always* allowed to be absent at the schema level (since title/tagline/meta/characters
  targets legitimately don't need an index at all), so this cross-field validation ("index is
  required, but only for these two specific target types") has to be written as explicit code
  here rather than being declared in the Pydantic model itself.

```python
    state = {
        "request_id": uuid.uuid4().hex,
        "mode": mode,
        "canon_script": req.script.model_dump(),
        "target_index": req.target.index,
        "mood": req.mood,
        "director": req.director,
        "note": req.note,
        "trace": [],
    }
    try:
        script, meta = run(state)
        return GenerateResponse(script=script, meta={**meta, "title": script.movie_title})
    except RateLimitExceeded as exc:
        return _err(429, "rate_limit", str(exc))
    except AgentError as exc:
        return _err(502, "agent", str(exc))
    except Exception as exc:  # noqa: BLE001
        return _err(500, "server", f"{type(exc).__name__}: {exc}")
```
- `"canon_script": req.script.model_dump()` — converts the client's round-tripped `Script`
  object (already validated as a real `Script` by `RegenerateRequest`'s own field typing) back
  to a plain dict for storage in `ScriptState` — the dict↔object round-trip pattern, here at the
  point a regeneration request *enters* the system, mirroring where it gets reconstructed back
  into an object inside each `n_regen_*` node in `pipeline.py`.
- Note `voice_system` is **not** set here in `state` at all (unlike `_generate_state`, which also
  doesn't set it — it's always computed by the `dispatch` node, which both the full-generation
  and every regeneration mode pass through first, per the graph's structure) — every mode
  reaches `dispatch` before its actual work node, so `voice_system` is always populated by the
  time it's needed, regardless of entry mode.
- This endpoint's body is otherwise a near-exact structural twin of `generate()` above —
  same `run(state)` call, same tuple-unpack, same three-tier exception handling — the only real
  differences are how `state` itself gets built (full generation's fixed shape vs.
  regeneration's mode-lookup + canon-script-carrying shape) and the validation checks at the top.

```python
@app.get("/")
def root():
    return {"service": "AI Bollywood Script Generator", "docs": "/docs", "health": "/api/health"}
```
- A minimal root route — mostly so hitting the bare service URL in a browser (or an automated
  health-check probe expecting *something* at `/`) gets a helpful, human-readable response
  pointing to the real docs/health endpoints, rather than FastAPI's default `404 Not Found`.

---

## Recap: the shape of the whole backend, now that every line has been walked through

- **`config.py`** decides every tunable once. **`schemas.py`** decides every shape once.
  **`state.py`** decides what one request's working memory looks like.
- **`rate_limiter.py`** and **`client.py`** together are the *only* code that ever talks to
  Gemini, and *every* call — from any agent, in any mode — passes through both.
- **`prompts_loader.py`** builds the shared creative context once per (mood, director) pair;
  **`agents.py`** appends each agent's narrow job on top of it and is the only code that
  constructs prompts.
- **`pipeline.py`** is the only code that decides *what order* agents run in, and the only place
  that knows about the critic loop or regeneration's canon-locking.
- **`logger.py`** watches everything happen, without being able to break anything by watching.
- **`main.py`** is the only code that knows about HTTP/WebSocket wire formats at all — every
  other file operates purely on Python objects and dicts, oblivious to whether the eventual
  caller is a browser, a test, or a curl command.

Every one of those boundaries is a real design decision, not an accident of how the files
happened to get split up — and each one is a legitimate, specific answer to "why is this file
shaped the way it is" in an interview.


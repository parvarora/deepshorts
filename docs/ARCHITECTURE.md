# Architecture — AI Bollywood Script Generator

Living design doc. Captures the agreed multi-agent system so it can be explained and
navigated without the AI (an explicit evaluation criterion).

## Product
User gives an ordinary real-world situation (+ optional **mood** and **director**). The
system returns a dramatic, over-engineered multi-scene movie: title, tagline, character
cards, and scenes (each with index, description, dialogue). Fun, dramatic, over-the-top.

## Stack (lean by choice)
- **Orchestration:** LangGraph (stateful graph, loops, checkpointer, streaming).
- **Models:** Google **Gemini API** via the `google-genai` SDK, with a model fallback chain —
  a stronger "thinking" model for the Architect + Critic (the reasoning-heavy nodes), a fast
  model for the high-volume Scene Generator + Punch-Up nodes.
- **Structured output:** Gemini **native** structured output (`response_schema` = Pydantic model,
  `response_mime_type="application/json"`), re-validated by our deterministic Structural Validator.
  Native schema removes most invalid-JSON failures — no `instructor`/OpenRouter needed.
- **LangChain:** NOT required. LangGraph calls the Gemini SDK directly; `langchain-google-genai`
  only if ever wanted.
- **Out of core:** Neo4j, Mem0 (revisit Mem0 as Tier-3 personalization only).
- **Backend:** FastAPI. **Frontend:** React. **History:** browser localStorage (source of truth).
- **Secrets:** `GEMINI_API_KEY` in `.env` (never committed); ship `.env.example` with a dummy key.

## The agent pipeline (Pixar model — single responsibility per node)
The craft "rubric" (belovedness research in `research/`) lives in the **Critic**, NOT in the
generator. Generators stay free; the Critic judges.

```
situation ─▶ STORY ARCHITECT ─▶ CHARACTER FORGE ─▶ SCENE GENERATOR ─▶ DIALOGUE PUNCH-UP ─┐
mood,         analyze + amplify    cast: goal, fear,   the big node:      register-aware    │
director      to the register;     trait, relations;   desc + dialogue    enhance-only      │
              cast plan + arc;      → also feeds UI     per scene                            ▼
              decides scene count     character cards                          ┌────────────────────┐
                    ▲                                                          │ STRUCTURAL CHECK    │ code,
                    │ revise notes (≤2)                                        │ (Pydantic) → repair │ free
                    │                                                          └─────────┬──────────┘
            ┌───────┴────────────┐                                       invalid │        │ valid
            │ CRITIC / SCRIPT DR │◀──────────────────────────────────────────────┘        ▼
            │ craft + escalation │                                                    assemble → final JSON
            │ + consistency      │
            └────────────────────┘
```

### Nodes
1. **Story Architect** — merges Situation-Analyzer + Drama-Amplifier. Finds the human truth,
   amplifies **in service of the chosen mood/director** (not always max-absurd), casts the
   plan, designs the arc, and **decides the scene count** for maximum drama (no fixed bound).
2. **Character Forge** — larger-than-life characters: name, role, description, goal, fear,
   dramatic trait, relationship-to-conflict. Output feeds both Scene Generator and the UI cards.
3. **Scene Generator** — the primary engine; writes each scene (description + dialogue),
   honoring character voices and the register.
4. **Dialogue Punch-Up** — enhances dialogue only (no structural rewrites); **register-aware**
   (a tragedy is not given trailer one-liners).
5. **Critic / Script Doctor** (LLM) — scores against craft/escalation/consistency/memorability;
   passes or returns targeted notes. **Always on.**
6. **Structural Validator** (deterministic code, not an LLM) — Pydantic schema + completeness;
   triggers targeted repair. This is the "proper error handling" feature, cheap and reliable.

### Reasoning layers (capable nodes)
Each node deliberates internally — generate options, self-critique, choose — and emits only the
result (e.g., Architect drafts 3 escalation paths and picks the best for the register).

### Loops (all bounded by max-iteration guards)
- **A. Scene Generator ↔ Critic** — craft/escalation/consistency revision (≤2 passes). Always on.
- **B. Structural Validator → targeted repair** — regenerate only the broken piece, not the script.
- **C. Consistency/canon loop** — used during regeneration to keep new content consistent.

## Regenerate-specific-section (bonus feature)
LangGraph is stateful + checkpointed, so "regenerate" = re-enter the graph at one node with the
rest frozen as canon context:
- Regenerate scene N → enter at Scene Generator with other scenes locked → Punch-Up + Critic for that scene.
- Regenerate title/tagline → enter at assemble/Editor.
- Regenerate a character → enter at Character Forge, then re-thread affected scenes.
Frozen-canon context (carried in state) keeps regenerations consistent — no graph DB needed.

## Robustness / orchestration
- Model **fallback chain** on 429/timeout.
- Per-node **retries + timeouts**; graceful degradation (if Critic times out, ship last good draft).
- **Streaming** scenes to the UI to hide latency.
- Optional LangSmith tracing.

## Decisions log
- Scene count: **no bound** — the AI chooses the number for maximum dramatic/over-engineered effect.
- Critic loop: **always on** (≤2 passes).
- Mood + Director are injected into the system prompt via slots (see `prompts/script_generator.system.md`):
  Director = the *how* (voice); Mood = the *register*; "tell this mood's story through this director's mind."
- LangChain optional; Neo4j + Mem0 out of core.
- Model provider: **Google Gemini API** (`google-genai` SDK); native structured output via
  `response_schema`. Keys in `.env`, dummy in `.env.example`, never committed.
- Default register: **Maximum Drama** (absurd blockbuster) — used when no mood is selected, so
  the out-of-box experience matches the assignment headline. Overridden by any dropdown mood.

## Where the craft material lives (so it doesn't all pile into one prompt)
Three pasted "mega-prompts" (max-absurd DramaGPT vs. two realism/human-simulator prompts) were
deliberately split by layer instead of concatenated (concatenation = contradictory mush):
- **Universal craft** (5 thinking layers, character wound/contradiction, subtext, earned emotion,
  "antagonist believes he's right," scenes must turn) → base system prompt (light) + **Character
  Forge** node + **Critic** rubric. True across all genres.
- **Maximal absurd** (small→massive, deadly-serious silliness, thunder/slow-mo, trailer Hinglish,
  Level-5) → the **Maximum Drama** mood block (`prompts/moods/maximum-drama.md`), which is also the
  default register. One flavor, not a universal law — keeps Tragedy/Thriller moods truly possible.

## Open items
- Pin exact latest Gemini model IDs + `google-genai` structured-output calls from current docs at build time.
- Mood library: DONE — `maximum-drama.md` (default) + 15 dropdown moods in `prompts/moods/`
  (bollywood-blockbuster, south-indian-mass, comedy-chaos, corporate-war, action-thriller,
  spy-thriller, sci-fi-epic, mythological-epic, romantic-drama, tragic-masterpiece, horror,
  political-thriller, sports-underdog, historical-epic, random-madness) + README. Mood is
  fully authoritative over register.
- Director library: DONE — 10 director-mind blocks in `prompts/directors/` (raj-and-dk, anurag-kashyap, neeraj-pandey, sanjay-leela-bhansali, imtiaz-ali, tvf-chandan-kumar, rajkumar-hirani, karan-johar, rohit-shetty, aditya-dhar) + README.
- Character Forge + Critic node prompts will carry the deeper character-engine + quality-gate craft from the realism prompts.
- Few-shot examples spanning director×mood pairings.

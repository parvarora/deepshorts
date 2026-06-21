"""The agents. Each has ONE narrow job and a validated structured output.

Pixar model, not 'six writers': Architect designs, Screenwriter writes, Critic judges.
Regeneration agents touch only the requested slice. Keeping jobs narrow is what keeps a
weak/fast model from drifting and compounding errors across hand-offs.

Each agent's system prompt = shared voice/craft context + its own role section. We pass
each agent ONLY what it needs (no full-history bloat).
"""
from __future__ import annotations

from app.llm.client import GeminiClient
from app.schemas import (
    Blueprint, CharactersOut, Critique, DialogueOut, MetaOut, Scene, ScenesOut, Script,
)

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

SCREENWRITER_ROLE = """# YOUR ROLE: SCREENWRITER
Write EVERY scene fully from the blueprint, in order. For each scene: scene_index (matching the
plan), scene_title (short), heading, scene_description (what happens and how it is staged), and
dialogue as a list of {character, delivery, line}. Honor the register and the director's voice.
Keep characters perfectly consistent with the blueprint and escalate scene over scene.
Output {"scenes": [...]} only."""

REVISE_ROLE = """# YOUR ROLE: SCREENWRITER (revision pass)
You are revising your draft against the Script Doctor's notes. Fix EVERY listed issue while
keeping what already works; preserve scene_index numbering and character consistency. Do not
weaken the climax. Output the full corrected {"scenes": [...]} only."""

CRITIC_ROLE = """# YOUR ROLE: SCRIPT DOCTOR (quality control)
Judge the assembled script hard but fairly. Check:
- escalation: each scene bigger / higher-stakes than the one before; climax stronger than the open
- consistency: characters, world, and established facts hold across scenes
- register fit: it genuinely matches the intended mood/register
- dialogue: at least one memorable, quotable line per scene; voices are distinct
- structure: a clear climax and a deliberate ending; every scene has description + dialogue
Return {passed, score 0-100, issues:[{scene_index, problem, fix}], note}. Pass ONLY if it is
genuinely strong; otherwise give concrete, actionable fixes (not vibes). Output JSON only."""

REGEN_SCENE_ROLE = """# YOUR ROLE: SCREENWRITER (single-scene rewrite)
Rewrite ONLY the requested scene. The other scenes are LOCKED CANON — do not change them, and
keep your new scene fully consistent with them and with the characters. Keep the same scene_index.
Make it stronger and fresh. Output the single rewritten scene JSON only."""

REGEN_DIALOGUE_ROLE = """# YOUR ROLE: DIALOGUE PASS (one scene)
Rewrite ONLY the dialogue of the requested scene. Keep the scene's heading and scene_description
unchanged in meaning, and keep the same speakers (from the character list). Make the lines punchier
and more memorable while staying true to the register and voice. Output {"dialogue": [...]} only."""

REGEN_META_ROLE = """# YOUR ROLE: TITLE & TAGLINE
Given the film, produce a fresh movie_title, tagline, and one-line logline that are blockbuster-worthy
and true to the register and voice. Output {movie_title, tagline, logline} only."""

REGEN_CHARACTERS_ROLE = """# YOUR ROLE: CHARACTER FORGE
Recast the characters to be more vivid and memorable while keeping them compatible with the existing
scenes. Each: name, role, description (+ internal want, fear, contradiction). Output {"characters": [...]} only."""


# ---------------------------------------------------------------- agent calls
def architect(client: GeminiClient, voice: str, request_id: str, situation: str,
              characters_hint: str | None = None) -> Blueprint:
    user = f"SITUATION:\n{situation or '(none provided — invent a fitting everyday situation)'}"
    if characters_hint:
        user += f"\n\nCHARACTER HINTS: {characters_hint}"
    return client.generate_json(request_id, "architect", voice + "\n\n" + ARCHITECT_ROLE, user, Blueprint)


def screenwriter(client: GeminiClient, voice: str, request_id: str, blueprint: Blueprint,
                 critique: Critique | None = None, prev: list[Scene] | None = None) -> list[Scene]:
    role = REVISE_ROLE if critique else SCREENWRITER_ROLE
    user = "BLUEPRINT:\n" + blueprint.model_dump_json(indent=2)
    if critique and prev:
        user += "\n\nYOUR PREVIOUS SCENES:\n" + ScenesOut(scenes=prev).model_dump_json(indent=2)
        user += "\n\nSCRIPT DOCTOR NOTES TO ADDRESS:\n" + critique.model_dump_json(indent=2)
    out = client.generate_json(request_id, "screenwriter", voice + "\n\n" + role, user, ScenesOut)
    return out.scenes


def critic(client: GeminiClient, voice: str, request_id: str, script: Script) -> Critique:
    user = "SCRIPT TO JUDGE:\n" + script.model_dump_json(indent=2)
    return client.generate_json(request_id, "critic", voice + "\n\n" + CRITIC_ROLE, user, Critique)


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


def regen_meta(client: GeminiClient, voice: str, request_id: str, script: Script,
               note: str | None) -> MetaOut:
    user = (
        f"FILM register: {script.mood}\nLOGLINE: {script.logline}\n"
        f"FIRST SCENE: {script.scenes[0].scene_description[:600]}\n"
        f"\nNOTE: {note or 'give a fresh blockbuster title, tagline, and logline'}"
    )
    return client.generate_json(request_id, "regen_meta", voice + "\n\n" + REGEN_META_ROLE, user, MetaOut)


def regen_characters(client: GeminiClient, voice: str, request_id: str, script: Script,
                     note: str | None) -> CharactersOut:
    user = (
        f"FILM: {script.movie_title} ({script.mood})\nCURRENT CHARACTERS:\n"
        + script.model_dump_json(include={"characters"}, indent=2)
        + f"\n\nNOTE: {note or 'make them more vivid; keep them compatible with the existing scenes'}"
    )
    return client.generate_json(request_id, "regen_characters", voice + "\n\n" + REGEN_CHARACTERS_ROLE, user, CharactersOut)

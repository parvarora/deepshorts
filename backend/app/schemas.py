"""Pydantic models = the structured contract every agent hands off and the API returns.

Structured handoffs are validated at every boundary; nothing passes freeform prose to
the next agent. This is the single most important defense against silent breakage in a
multi-agent pipeline.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------- core story objects ----------
class Character(BaseModel):
    name: str
    role: str
    description: str
    # internal craft fields (used by the screenwriter; harmless in the UI cards)
    want: Optional[str] = None
    fear: Optional[str] = None
    contradiction: Optional[str] = None


class SceneBeat(BaseModel):
    """One line in the Architect's escalation plan (not yet a written scene)."""
    scene_index: int
    intent: str                                  # what happens / what turns
    heading: Optional[str] = None                # INT./EXT. LOCATION - TIME
    characters: list[str] = Field(default_factory=list)
    escalation: Optional[str] = None             # how it's bigger than the previous beat


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


class DialogueLine(BaseModel):
    character: str
    delivery: str = ""                           # parenthetical: tone / staging
    line: str = Field(
        description="Natural Hinglish (Hindi-led, Roman script) with English only for "
        "modern/technical words. Never plain English."
    )


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


class Issue(BaseModel):
    scene_index: Optional[int] = None
    problem: str
    fix: str


class Critique(BaseModel):
    passed: bool
    score: int = Field(ge=0, le=100)
    issues: list[Issue] = Field(default_factory=list)
    note: str = ""


class Script(BaseModel):
    """The full assembled film returned to the client and stored in history."""
    movie_title: str
    tagline: str
    mood: str
    logline: str = ""
    directed_in_the_style_of: str = "—"
    characters: list[Character]
    scenes: list[Scene] = Field(min_length=1)


# ---------- API request / response ----------
class GenerateRequest(BaseModel):
    situation: str = ""
    mood: Optional[str] = None                   # mood id (filename in prompts/moods)
    director: Optional[str] = None               # director id (filename in prompts/directors)
    characters_hint: Optional[str] = None


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


class GenerateResponse(BaseModel):
    ok: bool = True
    script: Script
    meta: dict = Field(default_factory=dict)     # request_id, converged, score, iterations,
    #                                              situation/mood/director echoes, trace[]

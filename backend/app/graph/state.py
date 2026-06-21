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

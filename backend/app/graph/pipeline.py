"""LangGraph orchestration: nodes, edges, the always-on critic loop, and regen routing.

Flow (full generation):
    START -> dispatch -> architect -> screenwriter -> critic -> (loop) -> finalize -> END
    The critic->revise loop is ALWAYS ON but hard-bounded by settings.max_iterations.

Flow (regeneration): START -> dispatch -> regen_<x> -> END   (one focused agent call)

Every node appends to state['trace'] so the UI can visualize which agent ran, in order,
with status + timing. The graph is also streamable (graph.stream) for live visualization.
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


# ----------------------------------------------------------------- helpers
def _trace(state: ScriptState, step: str, status: str, **detail) -> list:
    rec = {"step": step, "status": status, "ts": round(time.time(), 3), **detail}
    return list(state.get("trace", [])) + [rec]


def _assemble_full(state: ScriptState) -> Script:
    bp = Blueprint.model_validate(state["blueprint"])
    scenes = [Scene.model_validate(s) for s in state.get("scenes", [])]
    scenes.sort(key=lambda s: s.scene_index)
    return Script(
        movie_title=bp.movie_title,
        tagline=bp.tagline,
        mood=bp.mood or (state.get("mood") or "Maximum Drama"),
        logline=bp.logline,
        directed_in_the_style_of=pretty(state.get("director")),
        characters=bp.characters,
        scenes=scenes,
    )


# ----------------------------------------------------------------- nodes
def n_dispatch(state: ScriptState) -> dict:
    voice = compose_voice(state.get("mood"), state.get("director"))
    return {"voice_system": voice, "iteration": 0,
            "trace": _trace(state, "dispatch", "done", mode=state.get("mode", "full"))}


def n_architect(state: ScriptState) -> dict:
    bp = architect(get_client(), state["voice_system"], state["request_id"],
                   state.get("situation", ""), state.get("characters_hint"))
    return {"blueprint": bp.model_dump(),
            "trace": _trace(state, "architect", "done",
                            title=bp.movie_title, scenes_planned=len(bp.scene_plan),
                            characters=len(bp.characters))}


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


def n_critic(state: ScriptState) -> dict:
    crit = critic(get_client(), state["voice_system"], state["request_id"], _assemble_full(state))
    return {"critique": crit.model_dump(),
            "trace": _trace(state, "critic", "done",
                            passed=crit.passed, score=crit.score, issues=len(crit.issues))}


def n_finalize(state: ScriptState) -> dict:
    script = _assemble_full(state)
    passed = state.get("critique", {}).get("passed", False)
    return {"script": script.model_dump(), "converged": passed,
            "trace": _trace(state, "finalize", "done", converged=passed)}


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


def n_regen_dialogue(state: ScriptState) -> dict:
    script = Script.model_validate(state["canon_script"])
    idx = int(state["target_index"])
    out = regen_dialogue(get_client(), state["voice_system"], state["request_id"], script, idx, state.get("note"))
    for s in script.scenes:
        if s.scene_index == idx:
            s.dialogue = out.dialogue
    return {"script": script.model_dump(), "trace": _trace(state, "regen_dialogue", "done", index=idx)}


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


# ----------------------------------------------------------------- routing
def route_dispatch(state: ScriptState) -> str:
    return {
        "full": "architect",
        "regen_scene": "regen_scene",
        "regen_dialogue": "regen_dialogue",
        "regen_meta": "regen_meta",
        "regen_characters": "regen_characters",
    }.get(state.get("mode", "full"), "architect")


def route_after_critic(state: ScriptState) -> str:
    crit = state.get("critique", {})
    if crit.get("passed"):
        return "finalize"
    if state.get("iteration", 1) > settings.max_iterations:   # loop guard -> best effort
        return "finalize"
    return "revise"


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


GRAPH = _build()

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


def stream(initial: ScriptState):
    """Yield (node_name, partial_state) per completed node — powers live SSE visualization."""
    for chunk in GRAPH.stream(initial):
        for node_name, partial in chunk.items():
            yield node_name, partial

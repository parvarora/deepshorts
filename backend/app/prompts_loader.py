"""Compose the shared 'voice' system context from the prompt library.

final voice = base system prompt
              with the MOOD_DIRECTION slot filled by prompts/moods/<mood>.md
              and  the DIRECTOR_PROFILE slot filled by prompts/directors/<director>.md
              truncated at the per-film I/O contract (each agent defines its own I/O).

The mood + director blocks are injected ONCE into the shared context; each agent then
appends its own narrow role + output schema on top. Mood is authoritative over register.
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


def _read(path) -> str:
    return path.read_text(encoding="utf-8")


def _block(path) -> str:
    """A library block file minus its own HTML comment header."""
    return _HTML_COMMENT.sub("", _read(path)).strip()


def list_moods() -> list[str]:
    return sorted(p.stem for p in _MOODS.glob("*.md") if p.stem.lower() != "readme")


def list_directors() -> list[str]:
    return sorted(p.stem for p in _DIRECTORS.glob("*.md") if p.stem.lower() != "readme")


def pretty(idval: str | None) -> str:
    if not idval:
        return "—"
    return _PRETTY.get(idval, idval.replace("-", " ").title())


def _inject(base: str, marker: str, block: str) -> str:
    # Match ONLY standalone-line markers (the real slots), never inline mentions in prose.
    pat = re.compile(
        rf"^[ \t]*<!--\s*{marker}:START\s*-->[ \t]*\n.*?^[ \t]*<!--\s*{marker}:END\s*-->[ \t]*$",
        re.DOTALL | re.MULTILINE,
    )
    return pat.sub(lambda _m: block, base)


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

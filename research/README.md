# Research: The Anatomy of Belovedness

Distilled love-triggers from 13 beloved/cult Indian films, for use as a wisdom-input
to the script-generator pipeline.

## Contents
- **[ANATOMY_OF_BELOVEDNESS.md](ANATOMY_OF_BELOVEDNESS.md)** — the synthesis. Cross-film
  laws of belovedness, the 8 love-levers, a dedicated dialogue (construction + presentation)
  section, and a drop-in **Belovedness Playbook** for the generator's system prompt.
- **[per_film/](per_film/)** — one JSON per film, conforming to the love-trigger schema
  (`source`, `love_type`, `core_emotion`, `dialogue_style`, `signature_dialogues[]`,
  `the_peaks[]`, `wish_fulfillment`, `character_magnetism`, `audacity`, `portability`,
  `why_cult_not_just_good`, `transferable_love_triggers[]`, `grounding`, `confidence`).

## Method (grounding honesty)
- All 13 PDFs were extracted to text (`scriptss/_txt/`, via `pdftotext -layout`) and read.
- Iconic lines were grounded **verbatim from the scripts** wherever extraction allowed.
- **Exception:** Gangs of Wasseypur's Hindi dialogue did not text-extract from the supplied
  dub PDF; its lines are grounded via documented reception (sources cited in the synthesis).
- Each JSON tags claims `grounded` vs `inferred` and carries a `confidence` note, to avoid
  confabulating audience reactions.

## Corpus
3 Idiots · PK · Lage Raho Munna Bhai · Dangal · Stree · Tumbbad · Masaan · Article 15 ·
Rang De Basanti · Udaan · Chhichhore · Kapoor & Sons · Gangs of Wasseypur (Part 1)

# Frontend — AI Bollywood Script Generator

React + Vite + TypeScript. A cinematic, responsive UI over the multi-agent backend.

## Quick start
```bash
cd frontend
npm install
cp .env.example .env          # set VITE_API_BASE (default http://localhost:8000); Firebase optional
npm run dev                   # http://localhost:5173
```
The backend must be running (see `../backend/README.md`).

## What it does
**Left panel** — situation textarea (+ example chips), mood dropdown, Random Madness toggle,
director picker (with photos), and the Generate button.
**Right panel** — live **agent-thinking** pipeline view, then the movie: poster (title, tagline,
mood/director/score badges), character cards, and scene cards.
**Bottom** — past dramas (localStorage history); click to reopen.

## Feature → file map
| Feature | Where |
|---|---|
| Situation input + examples | `components/SituationInput.tsx` |
| Mood dropdown | `components/MoodSelector.tsx` (options from `/api/options`) |
| Random Madness toggle | `components/RandomMadnessToggle.tsx` (sets mood `random-madness`) |
| Director picker w/ photos | `components/DirectorSelector.tsx` (images served by backend) |
| **Show Agent Thinking** | `components/AgentThinking.tsx` ← SSE stream `/api/generate/stream` |
| Title / Tagline / Logline | `components/MovieOutput.tsx` |
| Character cards | `components/CharacterCard.tsx` |
| Scenes (index, description, dialogue) | `components/SceneCard.tsx` |
| Regenerate section buttons | `SceneCard` (scene/dialogue) + `MovieOutput` (title/tagline/recast) + App ("everything") |
| History (localStorage) | `hooks/useHistory.ts` + `components/HistoryPanel.tsx` |
| Share drama (public link) | `components/ShareButton.tsx` + `firebase.ts` + `/drama/:id` (`DramaView.tsx`) |
| Error handling | `components/ErrorBanner.tsx` (typed kinds: rate_limit / network / agent) |
| Responsive | `styles.css` (grid collapses to single column ≤920px) |

## API layer
`src/api.ts` is the single typed client (`generate`, `generateStream` (SSE), `regenerate`,
`getOptions`, `health`). Types in `src/types.ts` mirror the backend Pydantic schemas exactly.

## Sharing (optional)
Sharing uses Firebase Firestore. Without Firebase keys in `.env`, the rest of the app works
fully and the Share button explains it's disabled. With keys, "Share Drama" saves the script and
copies a `/drama/:id` public link.

## Notes
- Keys never live in source — `.env` is gitignored, `.env.example` ships dummy values.
- `npm run typecheck` for a strict TS pass; `npm run build` for a production bundle.

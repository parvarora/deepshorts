import { useState } from "react";
import { generateStream, regenerate } from "./api";
import type { GenerateMeta, RegenType, Script, TraceStep } from "./types";
import { useOptions } from "./hooks/useOptions";
import { useHistory } from "./hooks/useHistory";
import SituationInput from "./components/SituationInput";
import MoodSelector from "./components/MoodSelector";
import DirectorSelector from "./components/DirectorSelector";
import RandomMadnessToggle from "./components/RandomMadnessToggle";
import AgentThinking from "./components/AgentThinking";
import MovieOutput from "./components/MovieOutput";
import HistoryPanel from "./components/HistoryPanel";
import ErrorBanner from "./components/ErrorBanner";
import DramaView from "./components/DramaView";
import type { HistoryItem } from "./types";

type Status = "idle" | "generating" | "done" | "error";

export default function App() {
  // --- tiny router: /drama/:id is the shared read-only view (no hooks before this) ---
  const dramaMatch = window.location.pathname.match(/^\/drama\/([^/]+)$/);
  if (dramaMatch) return <DramaView id={dramaMatch[1]} />;
  return <Home />;
}

function Home() {
  const { options } = useOptions();
  const history = useHistory();

  const [situation, setSituation] = useState("");
  const [mood, setMood] = useState<string | null>(null);
  const [director, setDirector] = useState<string | null>(null);
  const [madness, setMadness] = useState(false);

  const [status, setStatus] = useState<Status>("idle");
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [script, setScript] = useState<Script | null>(null);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [error, setError] = useState<{ message: string; kind: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const effectiveMood = madness ? "random-madness" : mood;
  const locked = status === "generating";

  async function onGenerate() {
    if (locked) return;
    setStatus("generating");
    setError(null);
    setSteps([]);
    setScript(null);
    setMeta(null);
    setActiveId(null);

    await generateStream(
      { situation, mood: effectiveMood, director },
      {
        onStep: (_node, trace) => setSteps((prev) => [...prev, trace]),
        onResult: (s, m) => {
          setScript(s);
          setMeta(m);
          setStatus("done");
          const item = history.add(s, {
            situation,
            mood: effectiveMood,
            director,
          });
          setActiveId(item.id);
        },
        onError: (message, kind) => {
          setError({ message, kind });
          setStatus("error");
        },
      },
    );
  }

  async function onRegen(type: RegenType, index?: number) {
    if (!script || busy) return;
    const key = index != null ? `${type}:${index}` : `${type}:`;
    setBusy(key);
    setError(null);
    try {
      const res = await regenerate({
        script,
        target: { type, index: index ?? null },
        mood: effectiveMood,
        director,
      });
      setScript(res.script);
      if (activeId) history.update(activeId, res.script);
    } catch (e: any) {
      setError({ message: e?.message || "Regeneration failed", kind: e?.kind || "agent" });
    } finally {
      setBusy(null);
    }
  }

  function openHistory(item: HistoryItem) {
    setScript(item.script);
    setMeta({ mood: item.mood, director: item.director, situation: item.situation });
    setSituation(item.situation);
    setMood(item.mood);
    setDirector(item.director);
    setMadness(item.mood === "random-madness");
    setActiveId(item.id);
    setStatus("done");
    setSteps([]);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/">
          🎬 DeepShorts <span className="brand-sub">Bollywood Script Generator</span>
        </a>
        <span className="tagline-mini">Turn ordinary situations into absurd Bollywood-level drama</span>
      </header>

      <div className="layout">
        {/* LEFT */}
        <aside className="panel left-panel">
          <SituationInput value={situation} onChange={setSituation} disabled={locked} />
          <MoodSelector moods={options.moods} value={mood} onChange={setMood} disabled={locked || madness} />
          <RandomMadnessToggle on={madness} onToggle={setMadness} disabled={locked} />
          <DirectorSelector
            directors={options.directors}
            value={director}
            onChange={setDirector}
            disabled={locked}
          />
          <button
            className="btn-primary generate"
            onClick={onGenerate}
            disabled={locked || situation.trim().length === 0}
          >
            {locked ? "Rolling…" : "🎬 Generate Drama"}
          </button>
        </aside>

        {/* RIGHT */}
        <main className="panel right-panel">
          {error && <ErrorBanner message={error.message} kind={error.kind} onDismiss={() => setError(null)} />}

          {steps.length > 0 && <AgentThinking steps={steps} running={status === "generating"} />}

          {status === "done" && script && (
            <>
              <div className="output-toolbar">
                <button className="btn-ghost" onClick={onGenerate} disabled={Boolean(busy)}>
                  ↻ Regenerate everything
                </button>
              </div>
              <MovieOutput script={script} meta={meta} onRegen={onRegen} busy={busy} />
            </>
          )}

          {status === "idle" && steps.length === 0 && (
            <div className="empty-state">
              <div className="empty-reel">🎞️</div>
              <h2>Your blockbuster awaits</h2>
              <p>
                Describe an ordinary moment on the left, pick a mood (and a director, if you like),
                and watch the writers' room turn it into an over-the-top movie.
              </p>
            </div>
          )}
        </main>
      </div>

      <HistoryPanel
        items={history.items}
        activeId={activeId}
        onOpen={openHistory}
        onRemove={history.remove}
        onClear={history.clear}
      />

      <footer className="footer">
        Built for DeepShorts · multi-agent pipeline (Architect → Screenwriter → Script Doctor)
      </footer>
    </div>
  );
}

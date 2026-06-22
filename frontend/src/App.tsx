import { useState } from "react";
import { motion } from "framer-motion";
import { generateStream, regenerate } from "./api";
import type { GenerateMeta, RegenType, Script, TraceStep } from "./types";
import { useOptions } from "./hooks/useOptions";
import { useHistory } from "./hooks/useHistory";
import { useHealth } from "./hooks/useHealth";
import { useTheme } from "./hooks/useTheme";
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
  // tiny router: /drama/:id is the shared read-only view (kept hook-free above any hooks)
  const dramaMatch = window.location.pathname.match(/^\/drama\/([^/]+)$/);
  if (dramaMatch) return <DramaView id={dramaMatch[1]} />;
  return <Home />;
}

function Home() {
  const { options } = useOptions();
  const history = useHistory();
  const apiStatus = useHealth();
  const { theme, toggle: toggleTheme } = useTheme();

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
          const item = history.add(s, { situation, mood: effectiveMood, director });
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
      <div className="bg-aurora" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
      </div>

      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-emoji">🎬</span> DeepShorts
          <span className="brand-sub">Bollywood Script Generator</span>
        </a>
        <div className="topbar-right">
          <span className={`status-pill ${apiStatus}`}>
            <span className="status-dot" />
            {apiStatus === "online" ? "API Ready" : apiStatus === "offline" ? "API Offline" : "Checking…"}
          </span>
          <motion.button
            type="button"
            className="theme-toggle"
            whileTap={{ scale: 0.85 }}
            onClick={toggleTheme}
            aria-label="Toggle light/dark theme"
            title="Toggle theme"
          >
            {theme === "dark" ? "🌙" : "☀️"}
          </motion.button>
        </div>
      </header>

      <motion.section
        className="hero"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <span className="hero-eyebrow">AI Bollywood Script Generator</span>
        <h1 className="hero-title">Turn the ordinary into legend</h1>
        <p className="hero-sub">
          Describe a normal moment. Watch it become an absurd, over-engineered blockbuster.
        </p>

        <div className="command-card">
          <SituationInput value={situation} onChange={setSituation} disabled={locked} />

          <div className="controls-row">
            <MoodSelector
              moods={options.moods}
              value={mood}
              onChange={setMood}
              disabled={locked || madness}
            />
            <RandomMadnessToggle on={madness} onToggle={setMadness} disabled={locked} />
          </div>

          <DirectorSelector
            directors={options.directors}
            value={director}
            onChange={setDirector}
            disabled={locked}
          />

          <button
            type="button"
            className="btn-primary generate"
            onClick={onGenerate}
            disabled={locked || situation.trim().length === 0}
          >
            {locked ? (
              <>
                <span className="btn-spinner" /> Rolling camera…
              </>
            ) : (
              "🎬 Generate Drama"
            )}
          </button>
        </div>
      </motion.section>

      <main className="results">
        {error && <ErrorBanner message={error.message} kind={error.kind} onDismiss={() => setError(null)} />}

        {steps.length > 0 && <AgentThinking steps={steps} running={status === "generating"} />}

        {status === "done" && script && (
          <MovieOutput
            script={script}
            meta={meta}
            onRegen={onRegen}
            onRegenerateAll={onGenerate}
            busy={busy}
          />
        )}

        {status === "idle" && steps.length === 0 && (
          <div className="empty-state">
            <div className="empty-reel">🎞️</div>
            <h2>Your blockbuster awaits</h2>
            <p>
              Describe an ordinary moment above, pick a mood (and a director, if you like), and
              watch the writers' room turn it into an over-the-top movie.
            </p>
          </div>
        )}
      </main>

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

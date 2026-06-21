import { useState } from "react";
import { motion } from "framer-motion";
import type { GenerateMeta, RegenType, Script } from "../types";
import CharacterCard from "./CharacterCard";
import SceneCard from "./SceneCard";
import ShareButton from "./ShareButton";
import Tabs from "./Tabs";
import { moodEmoji } from "../labels";

interface Props {
  script: Script;
  meta?: GenerateMeta | null;
  onRegen?: (type: RegenType, index?: number) => void;
  onRegenerateAll?: () => void;
  busy?: string | null;
  readOnly?: boolean;
}

export default function MovieOutput({ script, meta, onRegen, onRegenerateAll, busy, readOnly }: Props) {
  const [tab, setTab] = useState<"script" | "cast">("script");

  const RegenBtn = ({ type, label }: { type: RegenType; label: string }) =>
    !readOnly && onRegen ? (
      <button
        type="button"
        className="regen-btn ghost"
        disabled={Boolean(busy)}
        onClick={() => onRegen(type)}
      >
        {busy === `${type}:` ? "…" : `↻ ${label}`}
      </button>
    ) : null;

  const titleWords = script.movie_title.split(" ");

  return (
    <motion.div
      className="movie-output"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45 }}
    >
      <div className="poster">
        <div className="poster-meta">
          <span className="badge">
            {moodEmoji(meta?.mood)} {script.mood}
          </span>
          {script.directed_in_the_style_of && script.directed_in_the_style_of !== "—" && (
            <span className="badge subtle">🎬 {script.directed_in_the_style_of}</span>
          )}
          {meta?.score != null && <span className="badge subtle">★ {meta.score}/100</span>}
        </div>

        <h1 className="movie-title">
          {titleWords.map((w, i) => (
            <motion.span
              key={i}
              className="title-word"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              {w}&nbsp;
            </motion.span>
          ))}
          <RegenBtn type="title" label="Title" />
        </h1>
        <p className="movie-tagline">
          “{script.tagline}” <RegenBtn type="tagline" label="Tagline" />
        </p>
        {script.logline && <p className="movie-logline">{script.logline}</p>}

        <div className="poster-actions">
          <ShareButton script={script} />
          {!readOnly && onRegenerateAll && (
            <button type="button" className="btn-ghost" onClick={onRegenerateAll} disabled={Boolean(busy)}>
              ↻ Regenerate everything
            </button>
          )}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "script", label: `Script · ${script.scenes.length}` },
          { id: "cast", label: `Cast · ${script.characters.length}` },
        ]}
        active={tab}
        onChange={(id) => setTab(id as "script" | "cast")}
      />

      {tab === "cast" ? (
        <section className="section">
          <h2 className="section-title">
            Cast
            {!readOnly && onRegen && (
              <button
                type="button"
                className="regen-btn"
                disabled={Boolean(busy)}
                onClick={() => onRegen("characters")}
              >
                {busy === "characters:" ? "…" : "↻ Recast"}
              </button>
            )}
          </h2>
          <div className="character-grid">
            {script.characters.map((c, i) => (
              <CharacterCard key={i} c={c} index={i} />
            ))}
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="scenes">
            {script.scenes.map((s, i) => (
              <SceneCard
                key={s.scene_index}
                scene={s}
                index={i}
                onRegen={onRegen as any}
                busy={busy}
                readOnly={readOnly}
              />
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}

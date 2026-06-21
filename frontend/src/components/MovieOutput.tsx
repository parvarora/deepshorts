import type { GenerateMeta, RegenType, Script } from "../types";
import CharacterCard from "./CharacterCard";
import SceneCard from "./SceneCard";
import ShareButton from "./ShareButton";
import { moodEmoji } from "../labels";

interface Props {
  script: Script;
  meta?: GenerateMeta | null;
  onRegen?: (type: RegenType, index?: number) => void;
  busy?: string | null;
  readOnly?: boolean;
}

export default function MovieOutput({ script, meta, onRegen, busy, readOnly }: Props) {
  const RegenBtn = ({ type, label }: { type: RegenType; label: string }) =>
    !readOnly && onRegen ? (
      <button className="regen-btn" disabled={Boolean(busy)} onClick={() => onRegen(type)}>
        {busy === `${type}:` ? "…" : `↻ ${label}`}
      </button>
    ) : null;

  return (
    <div className="movie-output">
      <div className="poster">
        <div className="poster-meta">
          <span className="badge">{moodEmoji(meta?.mood)} {script.mood}</span>
          {script.directed_in_the_style_of && script.directed_in_the_style_of !== "—" && (
            <span className="badge subtle">🎬 {script.directed_in_the_style_of}</span>
          )}
          {meta?.score != null && <span className="badge subtle">★ {meta.score}/100</span>}
        </div>

        <h1 className="movie-title">
          {script.movie_title}
          <RegenBtn type="title" label="Title" />
        </h1>
        <p className="movie-tagline">
          “{script.tagline}”
          <RegenBtn type="tagline" label="Tagline" />
        </p>
        {script.logline && <p className="movie-logline">{script.logline}</p>}

        <div className="poster-actions">
          <ShareButton script={script} />
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">
          Cast
          {!readOnly && onRegen && (
            <button className="regen-btn" disabled={Boolean(busy)} onClick={() => onRegen("characters")}>
              {busy === "characters:" ? "…" : "↻ Recast"}
            </button>
          )}
        </h2>
        <div className="character-grid">
          {script.characters.map((c, i) => (
            <CharacterCard key={i} c={c} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">The Script</h2>
        <div className="scenes">
          {script.scenes.map((s) => (
            <SceneCard key={s.scene_index} scene={s} onRegen={onRegen as any} busy={busy} readOnly={readOnly} />
          ))}
        </div>
      </section>
    </div>
  );
}

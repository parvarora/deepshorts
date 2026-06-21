import type { RegenType, Scene } from "../types";

interface Props {
  scene: Scene;
  onRegen?: (type: RegenType, index: number) => void;
  busy?: string | null;
  readOnly?: boolean;
}

export default function SceneCard({ scene, onRegen, busy, readOnly }: Props) {
  const sceneBusy = busy === `scene:${scene.scene_index}`;
  const dlgBusy = busy === `dialogue:${scene.scene_index}`;
  const anyBusy = Boolean(busy);

  return (
    <article className={`scene-card ${sceneBusy ? "busy" : ""}`}>
      <header className="scene-head">
        <span className="scene-index">Scene {scene.scene_index}</span>
        {scene.scene_title && <span className="scene-title">{scene.scene_title}</span>}
        {!readOnly && onRegen && (
          <span className="scene-actions">
            <button
              className="regen-btn"
              disabled={anyBusy}
              onClick={() => onRegen("scene", scene.scene_index)}
            >
              {sceneBusy ? "…" : "↻ Scene"}
            </button>
            <button
              className="regen-btn"
              disabled={anyBusy}
              onClick={() => onRegen("dialogue", scene.scene_index)}
            >
              {dlgBusy ? "…" : "↻ Dialogue"}
            </button>
          </span>
        )}
      </header>

      {scene.heading && <div className="scene-heading">{scene.heading}</div>}
      <p className="scene-description">{scene.scene_description}</p>

      <div className="dialogue-block">
        {scene.dialogue.map((d, i) => (
          <div className="dialogue-line" key={i}>
            <div className="dialogue-name">{d.character.toUpperCase()}</div>
            {d.delivery && <div className="dialogue-delivery">{d.delivery}</div>}
            <div className="dialogue-text">{d.line}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

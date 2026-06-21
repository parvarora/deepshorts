import { motion } from "framer-motion";
import type { RegenType, Scene } from "../types";

interface Props {
  scene: Scene;
  index?: number;
  onRegen?: (type: RegenType, index: number) => void;
  busy?: string | null;
  readOnly?: boolean;
}

export default function SceneCard({ scene, index = 0, onRegen, busy, readOnly }: Props) {
  const sceneBusy = busy === `scene:${scene.scene_index}`;
  const dlgBusy = busy === `dialogue:${scene.scene_index}`;
  const anyBusy = Boolean(busy);

  return (
    <motion.article
      className={`scene-card ${sceneBusy ? "busy" : ""}`}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.3) }}
    >
      <header className="scene-head">
        <span className="scene-index">Scene {scene.scene_index}</span>
        {scene.scene_title && <span className="scene-title">{scene.scene_title}</span>}
        {!readOnly && onRegen && (
          <span className="scene-actions">
            <button
              type="button"
              className="regen-btn"
              disabled={anyBusy}
              onClick={() => onRegen("scene", scene.scene_index)}
            >
              {sceneBusy ? "…" : "↻ Scene"}
            </button>
            <button
              type="button"
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
            <span className="dialogue-name">{d.character.toUpperCase()}</span>
            {d.delivery && <span className="dialogue-delivery">{d.delivery}</span>}
            <p className="dialogue-text">{d.line}</p>
          </div>
        ))}
      </div>
    </motion.article>
  );
}

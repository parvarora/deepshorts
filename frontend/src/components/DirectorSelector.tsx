import { motion } from "framer-motion";
import type { DirectorOption } from "../types";
import { imageUrl } from "../api";

interface Props {
  directors: DirectorOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

function initials(label: string): string {
  return label
    .replace(/[^A-Za-z& ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export default function DirectorSelector({ directors, value, onChange, disabled }: Props) {
  return (
    <div className="field">
      <label className="field-label">Director's vision (optional)</label>
      <div className="director-carousel">
        <button
          type="button"
          className={`director-chip ${value === null ? "selected" : ""}`}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <span className="avatar-ring-wrap">
            {value === null && (
              <motion.span
                className="director-ring"
                layoutId="director-ring"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span className="director-avatar fallback">★</span>
          </span>
          <span className="director-name">No director</span>
        </button>

        {directors.map((d) => {
          const img = imageUrl(d.image);
          const selected = value === d.id;
          return (
            <button
              key={d.id}
              type="button"
              className={`director-chip ${selected ? "selected" : ""}`}
              disabled={disabled}
              onClick={() => onChange(selected ? null : d.id)}
              title={d.label}
            >
              <span className="avatar-ring-wrap">
                {selected && (
                  <motion.span
                    className="director-ring"
                    layoutId="director-ring"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                {img ? (
                  <img className="director-avatar" src={img} alt={d.label} loading="lazy" />
                ) : (
                  <span className="director-avatar fallback">{initials(d.label)}</span>
                )}
              </span>
              <span className="director-name">{d.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

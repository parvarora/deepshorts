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
      <label className="field-label">Director's vision</label>
      <div className="director-grid">
        <button
          type="button"
          className={`director-card none ${value === null ? "selected" : ""}`}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <div className="director-avatar fallback">★</div>
          <span className="director-name">No director</span>
          <span className="director-sub">Versatile</span>
        </button>

        {directors.map((d) => {
          const img = imageUrl(d.image);
          return (
            <button
              key={d.id}
              type="button"
              className={`director-card ${value === d.id ? "selected" : ""}`}
              disabled={disabled}
              onClick={() => onChange(value === d.id ? null : d.id)}
              title={d.label}
            >
              {img ? (
                <img className="director-avatar" src={img} alt={d.label} loading="lazy" />
              ) : (
                <div className="director-avatar fallback">{initials(d.label)}</div>
              )}
              <span className="director-name">{d.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

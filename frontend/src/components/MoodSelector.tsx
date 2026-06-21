import type { Option } from "../types";
import { moodEmoji } from "../labels";

interface Props {
  moods: Option[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

export default function MoodSelector({ moods, value, onChange, disabled }: Props) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="mood">
        Mood
      </label>
      <div className="select-wrap">
        <select
          id="mood"
          className="select"
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">🎬 Default — Maximum Drama</option>
          {moods
            .filter((m) => m.id !== "maximum-drama")
            .map((m) => (
              <option key={m.id} value={m.id}>
                {moodEmoji(m.id)} {m.label}
              </option>
            ))}
        </select>
        <span className="select-caret">▾</span>
      </div>
    </div>
  );
}

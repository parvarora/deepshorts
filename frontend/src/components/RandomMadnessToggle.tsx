interface Props {
  on: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}

export default function RandomMadnessToggle({ on, onToggle, disabled }: Props) {
  return (
    <button
      type="button"
      className={`madness-toggle ${on ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      aria-pressed={on}
    >
      <span className="madness-dice">🎲</span>
      <span className="madness-text">
        <strong>Random Madness</strong>
        <small>{on ? "Fusing genres that shouldn't work…" : "Off"}</small>
      </span>
      <span className={`switch ${on ? "on" : ""}`}>
        <span className="knob" />
      </span>
    </button>
  );
}

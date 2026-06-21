import { motion } from "framer-motion";

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
      <motion.span
        className="madness-dice"
        animate={on ? { rotate: 360 } : { rotate: 0 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      >
        🎲
      </motion.span>
      <span className="madness-text">
        <strong>Random Madness</strong>
        <small>{on ? "Fusing genres that shouldn't work…" : "Off"}</small>
      </span>
      <span className={`switch ${on ? "on" : ""}`}>
        <motion.span
          className="knob"
          layout
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        />
      </span>
    </button>
  );
}

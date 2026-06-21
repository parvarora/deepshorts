import { motion } from "framer-motion";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

const EXAMPLES = [
  "Two founders fighting over putting sugar in coffee",
  "A robot enters an AI conference to fight Sam Altman and Elon Musk",
  "Roommate ate the last Maggi",
  "Forgot to mute on a Zoom call",
];

export default function SituationInput({ value, onChange, disabled }: Props) {
  return (
    <div className="field">
      <label className="field-label" htmlFor="situation">
        The ordinary situation
      </label>
      <textarea
        id="situation"
        className="situation-input"
        placeholder="e.g. Two founders fighting over putting sugar in coffee…"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
      <div className="example-chips">
        {EXAMPLES.map((ex, i) => (
          <motion.button
            key={ex}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => onChange(ex)}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05, duration: 0.3 }}
          >
            {ex}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

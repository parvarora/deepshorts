import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Option } from "../types";
import { moodEmoji } from "../labels";

interface Props {
  moods: Option[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}

export default function MoodSelector({ moods, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  // close automatically if disabled mid-open (e.g. Random Madness toggled on)
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const current = moods.find((m) => m.id === value);
  const visible = moods.filter((m) => m.id !== "maximum-drama");

  return (
    <div className="field mood-field" ref={ref}>
      <label className="field-label">Mood</label>
      <div className="mood-dropdown">
        <button
          type="button"
          className="mood-trigger"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
        >
          <span>
            {moodEmoji(value)} {current ? current.label : "Default — Maximum Drama"}
          </span>
          <span className={`caret ${open ? "up" : ""}`}>▾</span>
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              className="mood-panel"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
            >
              <button
                type="button"
                className={`mood-option ${!value ? "selected" : ""}`}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                🎬 Default — Maximum Drama
              </button>
              {visible.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`mood-option ${value === m.id ? "selected" : ""}`}
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                >
                  {moodEmoji(m.id)} {m.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

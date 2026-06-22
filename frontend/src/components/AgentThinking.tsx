import { AnimatePresence, motion } from "framer-motion";
import type { TraceStep } from "../types";
import { describeStep, STAGE_KEYS, STAGE_TITLES, type StageKey } from "../labels";

interface Props {
  steps: TraceStep[];
  running: boolean;
}

const STAGE_ICONS: Record<StageKey, string> = {
  dispatch: "📜",
  architect: "📐",
  screenwriter: "✍️",
  critic: "🩺",
  finalize: "🎬",
};

/** A fixed-height (~2in) animated "now happening" panel — replaces a growing log
 *  with a contained ticker so the page doesn't jump around as steps stream in. */
export default function AgentThinking({ steps, running }: Props) {
  const last = steps[steps.length - 1];
  const currentKey: StageKey = (last?.step as StageKey) ?? "dispatch";
  const stageIdx = Math.max(0, STAGE_KEYS.indexOf(currentKey));
  const pct = ((stageIdx + 1) / STAGE_KEYS.length) * 100;

  const display = last ? describeStep(last) : { label: "Warming up the writers' room…", detail: "" };
  const icon = STAGE_ICONS[currentKey] ?? "🎬";

  return (
    <motion.div
      className="pipeline-box"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pipeline-top">
        <span className="pipeline-stage">{STAGE_TITLES[currentKey]}</span>
        <span className="pipeline-count">
          {Math.min(stageIdx + 1, STAGE_KEYS.length)} / {STAGE_KEYS.length}
        </span>
      </div>

      <div className="pipeline-track">
        <motion.div
          className="pipeline-track-fill"
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      <div className="pipeline-display">
        <AnimatePresence mode="wait">
          <motion.div
            key={steps.length}
            className="pipeline-row"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.3 }}
          >
            <motion.span
              className="pipeline-icon"
              animate={running ? { y: [0, -5, 0] } : { y: 0 }}
              transition={
                running
                  ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
            >
              {icon}
            </motion.span>
            <div className="pipeline-text">
              <div className="pipeline-label">{display.label}</div>
              {display.detail && <div className="pipeline-detail">{display.detail}</div>}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

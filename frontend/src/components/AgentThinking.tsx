import { AnimatePresence, motion } from "framer-motion";
import type { TraceStep } from "../types";
import { describeStep, STAGE_KEYS, STAGE_TITLES } from "../labels";

interface Props {
  steps: TraceStep[];
  running: boolean;
}

/** Live view of the multi-agent pipeline: a fixed stepper + a streaming detail feed. */
export default function AgentThinking({ steps, running }: Props) {
  const seen = new Set(steps.map((s) => s.step));
  const lastStep = steps[steps.length - 1];
  const activeKey = running ? lastStep?.step ?? "dispatch" : null;

  return (
    <motion.div
      className="pipeline-card"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pipeline-head">
        <span className="reel">🎞️</span> The writers' room
      </div>

      <div className="stepper">
        {STAGE_KEYS.map((key, i) => {
          const active = key === activeKey;
          const reached = seen.has(key) || active;
          const done = reached && !active;
          return (
            <div className="stepper-node-wrap" key={key}>
              <div
                className={`stepper-node ${done ? "done" : ""} ${active ? "active" : ""} ${
                  !reached ? "pending" : ""
                }`}
              >
                {done ? "✓" : active ? <span className="stepper-pulse" /> : i + 1}
              </div>
              <div className="stepper-label">{STAGE_TITLES[key]}</div>
              {i < STAGE_KEYS.length - 1 && (
                <div className={`stepper-line ${reached ? "filled" : ""}`} />
              )}
            </div>
          );
        })}
      </div>

      <ul className="agent-feed">
        <AnimatePresence initial={false}>
          {steps.map((s, i) => {
            const { label, detail } = describeStep(s);
            return (
              <motion.li
                key={i}
                className="agent-step"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
              >
                <span className="agent-tick">✓</span>
                <div>
                  <div className="agent-label">{label}</div>
                  {detail && <div className="agent-detail">{detail}</div>}
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {running && (
          <li className="agent-step active-row">
            <span className="agent-spinner" />
            <div className="agent-label dim">working…</div>
          </li>
        )}
      </ul>
    </motion.div>
  );
}

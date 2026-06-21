import type { TraceStep } from "../types";
import { describeStep } from "../labels";

interface Props {
  steps: TraceStep[];
  running: boolean;
}

/** Live view of the multi-agent pipeline — makes the architecture visible. */
export default function AgentThinking({ steps, running }: Props) {
  return (
    <div className="agent-thinking">
      <div className="agent-thinking-head">
        <span className="reel">🎞️</span> The writers' room
      </div>
      <ul className="agent-steps">
        {steps.map((s, i) => {
          const { label, detail } = describeStep(s);
          return (
            <li key={i} className="agent-step done">
              <span className="agent-tick">✓</span>
              <div>
                <div className="agent-label">{label}</div>
                {detail && <div className="agent-detail">{detail}</div>}
              </div>
            </li>
          );
        })}
        {running && (
          <li className="agent-step active">
            <span className="agent-spinner" />
            <div className="agent-label dim">working…</div>
          </li>
        )}
      </ul>
    </div>
  );
}

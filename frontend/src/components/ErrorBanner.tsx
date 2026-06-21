import { motion } from "framer-motion";

interface Props {
  message: string;
  kind?: string;
  onDismiss?: () => void;
}

const HINTS: Record<string, string> = {
  rate_limit: "Free-tier limit hit (15/min). Wait a moment and try again.",
  network: "Couldn't reach the backend. Is it running on port 8000?",
  agent: "The AI returned something unexpected. Please try again.",
};

export default function ErrorBanner({ message, kind, onDismiss }: Props) {
  return (
    <motion.div
      className="error-banner"
      role="alert"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, x: [0, -8, 8, -5, 5, 0] }}
      transition={{ duration: 0.4 }}
    >
      <span className="error-icon">⚠️</span>
      <div className="error-body">
        <strong>Failed to generate script.</strong>
        <span>{message}</span>
        {kind && HINTS[kind] && <span className="error-hint">{HINTS[kind]}</span>}
      </div>
      {onDismiss && (
        <button type="button" className="error-close" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </motion.div>
  );
}

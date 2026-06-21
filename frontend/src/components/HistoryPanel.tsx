import { motion } from "framer-motion";
import type { HistoryItem } from "../types";
import { moodEmoji } from "../labels";

interface Props {
  items: HistoryItem[];
  activeId: string | null;
  onOpen: (item: HistoryItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export default function HistoryPanel({ items, activeId, onOpen, onRemove, onClear }: Props) {
  return (
    <section className="history">
      <div className="history-head">
        <h2 className="section-title">Previously generated</h2>
        {items.length > 0 && (
          <button type="button" className="link-btn" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="history-empty">Your generated movies will appear here.</p>
      ) : (
        <div className="history-carousel">
          {items.map((it, i) => (
            <motion.div
              key={it.id}
              className={`history-card ${it.id === activeId ? "active" : ""}`}
              onClick={() => onOpen(it)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.3) }}
              whileHover={{ y: -3 }}
            >
              <div className="history-emoji">{moodEmoji(it.mood)}</div>
              <div className="history-info">
                <div className="history-title">{it.title}</div>
                <div className="history-sub">
                  {new Date(it.date).toLocaleDateString()} ·{" "}
                  {it.mood ? it.mood.replace(/-/g, " ") : "maximum drama"}
                </div>
              </div>
              <button
                type="button"
                className="history-del"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(it.id);
                }}
              >
                ✕
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </section>
  );
}

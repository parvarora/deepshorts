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
        <h2 className="section-title">Past dramas</h2>
        {items.length > 0 && (
          <button className="link-btn" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="history-empty">Your generated movies will appear here.</p>
      ) : (
        <div className="history-grid">
          {items.map((it) => (
            <div
              key={it.id}
              className={`history-card ${it.id === activeId ? "active" : ""}`}
              onClick={() => onOpen(it)}
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
                className="history-del"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(it.id);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import type { HistoryItem, Script } from "../types";

const KEY = "deepshorts.history.v1";
const MAX = 30;

function load(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

/** Past generated movies, persisted to localStorage (assignment: "store locally"). */
export function useHistory() {
  const [items, setItems] = useState<HistoryItem[]>(load);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);

  const add = useCallback(
    (script: Script, meta: { situation?: string | null; mood?: string | null; director?: string | null }) => {
      const item: HistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: script.movie_title,
        mood: meta.mood ?? null,
        director: meta.director ?? null,
        situation: meta.situation ?? "",
        date: new Date().toISOString(),
        script,
      };
      setItems((prev) => [item, ...prev].slice(0, MAX));
      return item;
    },
    [],
  );

  // Keep the saved copy of an item in sync (e.g. after a regeneration).
  const update = useCallback((id: string, script: Script) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, script, title: script.movie_title } : it)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, add, update, remove, clear };
}

import { useEffect, useState } from "react";
import type { Script } from "../types";
import { getDrama, firebaseEnabled } from "../firebase";
import MovieOutput from "./MovieOutput";

/** Read-only public view for a shared drama: /drama/:id */
export default function DramaView({ id }: { id: string }) {
  const [script, setScript] = useState<Script | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    if (!firebaseEnabled) {
      setStatus("missing");
      return;
    }
    getDrama(id)
      .then((s) => {
        setScript(s);
        setStatus(s ? "ready" : "missing");
      })
      .catch(() => setStatus("missing"));
  }, [id]);

  return (
    <div className="drama-page">
      <header className="topbar">
        <a className="brand" href="/">
          🎬 DeepShorts
        </a>
        <a className="btn-primary small" href="/">
          Create your own
        </a>
      </header>
      <main className="drama-main">
        {status === "loading" && <div className="loading-note">Loading drama…</div>}
        {status === "missing" && (
          <div className="loading-note">
            This drama couldn't be found{!firebaseEnabled ? " (sharing not configured)" : ""}.
          </div>
        )}
        {status === "ready" && script && <MovieOutput script={script} readOnly />}
      </main>
    </div>
  );
}

import { useState } from "react";
import type { Script } from "../types";
import { firebaseEnabled, shareDrama } from "../firebase";

export default function ShareButton({ script }: { script: Script }) {
  const [state, setState] = useState<"idle" | "sharing" | "done" | "error">("idle");
  const [link, setLink] = useState("");

  async function onShare() {
    if (!firebaseEnabled) {
      setState("error");
      return;
    }
    setState("sharing");
    try {
      const id = await shareDrama(script);
      const url = `${window.location.origin}/drama/${id}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard may be blocked; link is still shown */
      }
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="share-wrap">
      <button className="btn-ghost" onClick={onShare} disabled={state === "sharing"}>
        🔗 {state === "sharing" ? "Sharing…" : "Share Drama"}
      </button>
      {state === "done" && (
        <a className="share-link" href={link} target="_blank" rel="noreferrer">
          Link copied — open
        </a>
      )}
      {state === "error" && (
        <span className="share-note">
          {firebaseEnabled ? "Share failed." : "Add Firebase keys in .env to enable sharing."}
        </span>
      )}
    </div>
  );
}

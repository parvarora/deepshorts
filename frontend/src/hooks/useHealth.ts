import { useEffect, useState } from "react";
import { health } from "../api";

export type HealthStatus = "checking" | "online" | "offline";

/** Tiny live status pill — pings the backend once on mount. */
export function useHealth(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    let alive = true;
    health()
      .then((h) => alive && setStatus(h.status === "ok" ? "online" : "offline"))
      .catch(() => alive && setStatus("offline"));
    return () => {
      alive = false;
    };
  }, []);

  return status;
}

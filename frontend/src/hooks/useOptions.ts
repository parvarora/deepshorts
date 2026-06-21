import { useEffect, useState } from "react";
import { getOptions } from "../api";
import type { Options } from "../types";

/** Fetch mood + director options for the dropdowns; degrade gracefully if offline. */
export function useOptions() {
  const [options, setOptions] = useState<Options>({ moods: [], directors: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getOptions()
      .then((o) => alive && setOptions(o))
      .catch(() => alive && setOptions({ moods: [], directors: [] }))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  return { options, loaded };
}

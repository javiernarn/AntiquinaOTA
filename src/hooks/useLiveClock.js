import { useEffect, useState } from "react";

// Re-renders every `intervalMs` so any component reading Date.now() stays live.
// Used to drive the duty-clock digits and the progress ring while a session runs.
export function useLiveClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}

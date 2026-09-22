import { useEffect, useState } from 'react';

/** Coarse clock that updates once per second, for the digital readouts. */
export function useNowSecond(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

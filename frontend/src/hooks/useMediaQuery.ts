import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = globalThis.matchMedia(query);
    if (media.matches !== matches) {
      setMatches(media.matches);
    }
    const listener = () => setMatches(media.matches);
    globalThis.addEventListener("resize", listener);
    return () => globalThis.removeEventListener("resize", listener);
  }, [matches, query]);

  return matches;
}

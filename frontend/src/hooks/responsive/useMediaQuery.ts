import { useEffect, useState } from "react";

function canUseMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

function readMatch(query: string, fallback: boolean): boolean {
  if (!canUseMatchMedia()) {
    return fallback;
  }
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => readMatch(query, fallback));

  useEffect(() => {
    if (!canUseMatchMedia()) {
      return;
    }
    const media = window.matchMedia(query);
    const sync = (next: boolean) => setMatches((prev) => (prev === next ? prev : next));
    sync(media.matches);

    const handleChange = (event: MediaQueryListEvent) => sync(event.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }

    media.onchange = handleChange;
    return () => {
      media.onchange = null;
    };
  }, [fallback, query]);

  return matches;
}

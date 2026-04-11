import { useState, useEffect } from 'react';

/**
 * Tailwind default breakpoints. Keep these in sync with tailwind.config.js
 * if we ever customize them. These are the single source of truth for JS
 * code that wants to react to the same breakpoints Tailwind uses in CSS.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Subscribe to an arbitrary media query. Prefer `useBreakpoint` below for
 * the common min-width cases so we don't drift from Tailwind.
 */
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

/**
 * Returns true when the viewport is >= the given Tailwind breakpoint, so
 * JS-side layout switches match what `sm:` / `md:` / `lg:` / `xl:` do in
 * CSS. Example: `useBreakpoint('md')` is true on tablets and up.
 */
export function useBreakpoint(breakpoint: Breakpoint): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[breakpoint]}px)`);
}

/**
 * Convenience wrapper for the common "is this phone-sized?" check. Phones
 * are anything below the `md` breakpoint (768px), which is the same cutoff
 * the sidebar uses to switch to a hamburger drawer and the calendar uses
 * to render MobileCalendar.
 *
 * Use this instead of re-typing `useMediaQuery('(max-width: 768px)')` in
 * each feature component so we only have one source of truth for the
 * phone breakpoint.
 */
export function useIsMobile(): boolean {
  return !useBreakpoint('md');
}

/**
 * Helpers for recovering from "stale chunk" failures that happen when a new
 * build is deployed while a tab is still running the old HTML. The old HTML
 * still references hashed chunk filenames that no longer exist on the
 * server, so any lazy `import()` for a route that hasn't been loaded yet
 * rejects with "Failed to fetch dynamically imported module" (or the
 * browser-specific equivalent). A single hard reload fetches fresh HTML
 * pointing at the current hashes and the app recovers.
 */

const RELOAD_GUARD_KEY = "__chunk_reload_attempted__";

const CHUNK_ERROR_MESSAGE_FRAGMENTS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

export function isChunkLoadError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  // webpack-style (harmless for Vite, but cheap to include)
  if (
    typeof err === "object" &&
    "name" in err &&
    (err as { name?: unknown }).name === "ChunkLoadError"
  ) {
    return true;
  }
  const message =
    typeof err === "string"
      ? err
      : typeof err === "object" &&
          err !== null &&
          "message" in err &&
          typeof (err as { message?: unknown }).message === "string"
        ? ((err as { message: string }).message)
        : "";
  if (!message) return false;
  return CHUNK_ERROR_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment),
  );
}

/**
 * Hard-reload the page once per session. The sessionStorage guard prevents
 * an infinite reload loop if the chunk is permanently missing (e.g. a
 * broken deploy) — after one attempt we fall through and let the
 * ErrorBoundary render a recovery UI.
 */
export function reloadOnceForStaleChunk(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") return;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  } catch {
    // sessionStorage can throw in private mode / disabled storage — in
    // that case we still try a single reload, but there's no guarantee
    // against a loop. That's acceptable: the alternative is showing a
    // broken page forever.
  }
  window.location.reload();
}

export function hasAttemptedChunkReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(RELOAD_GUARD_KEY) === "1";
  } catch {
    return false;
  }
}

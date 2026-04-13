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
const RELOAD_GUARD_VALUE = "1";

const CHUNK_ERROR_MESSAGE_FRAGMENTS = [
  "Failed to fetch dynamically imported module",
  "Importing a module script failed",
  "error loading dynamically imported module",
];

function matchesChunkFragment(message: string): boolean {
  return CHUNK_ERROR_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment),
  );
}

export function isChunkLoadError(err: unknown): boolean {
  if (err instanceof Error) {
    // webpack-style (harmless for Vite, but cheap to include).
    if (err.name === "ChunkLoadError") return true;
    return matchesChunkFragment(err.message);
  }
  if (typeof err === "string") {
    return matchesChunkFragment(err);
  }
  return false;
}

function readReloadGuard(): string | null {
  try {
    return globalThis.sessionStorage.getItem(RELOAD_GUARD_KEY);
  } catch (err) {
    // Storage access can throw in private mode / disabled storage.
    console.debug("chunkError: sessionStorage read failed", err);
    return null;
  }
}

function writeReloadGuard(): void {
  try {
    globalThis.sessionStorage.setItem(RELOAD_GUARD_KEY, RELOAD_GUARD_VALUE);
  } catch (err) {
    // Non-fatal: we lose the one-reload guarantee but still recover.
    console.debug("chunkError: sessionStorage write failed", err);
  }
}

/**
 * Hard-reload the page once per session. The sessionStorage guard prevents
 * an infinite reload loop if the chunk is permanently missing (e.g. a
 * broken deploy) — after one attempt we fall through and let the
 * ErrorBoundary render a recovery UI.
 */
export function reloadOnceForStaleChunk(): void {
  if (typeof globalThis.window === "undefined") return;
  if (readReloadGuard() === RELOAD_GUARD_VALUE) return;
  writeReloadGuard();
  globalThis.location.reload();
}

export function hasAttemptedChunkReload(): boolean {
  if (typeof globalThis.window === "undefined") return false;
  return readReloadGuard() === RELOAD_GUARD_VALUE;
}

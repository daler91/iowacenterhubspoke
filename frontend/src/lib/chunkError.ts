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

function getErrorName(err: unknown): string {
  if (err !== null && typeof err === "object" && "name" in err) {
    const { name } = err as { name: unknown };
    if (typeof name === "string") return name;
  }
  return "";
}

function getErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err !== null && typeof err === "object" && "message" in err) {
    const { message } = err as { message: unknown };
    if (typeof message === "string") return message;
  }
  return "";
}

export function isChunkLoadError(err: unknown): boolean {
  // webpack-style (harmless for Vite, but cheap to include).
  if (getErrorName(err) === "ChunkLoadError") return true;
  const message = getErrorMessage(err);
  if (!message) return false;
  return CHUNK_ERROR_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment),
  );
}

function readReloadGuard(): string | null {
  try {
    return window.sessionStorage.getItem(RELOAD_GUARD_KEY);
  } catch (err) {
    // Storage access can throw in private mode / disabled storage.
    console.debug("chunkError: sessionStorage read failed", err);
    return null;
  }
}

function writeReloadGuard(): void {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
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
  if (typeof window === "undefined") return;
  if (readReloadGuard() === "1") return;
  writeReloadGuard();
  window.location.reload();
}

export function hasAttemptedChunkReload(): boolean {
  if (typeof window === "undefined") return false;
  return readReloadGuard() === "1";
}

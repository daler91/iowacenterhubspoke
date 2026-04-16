import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { isChunkLoadError, reloadOnceForStaleChunk } from "@/lib/chunkError";
import {
  CONSENT_CHANGED_EVENT,
  initPostHogIfConsented,
} from "@/lib/consent";

// Sentry error tracking (opt-in via VITE_SENTRY_DSN env var)
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.2,
    });
  });
}

// PostHog analytics (opt-in via VITE_POSTHOG_KEY env var). Loaded from the
// bundle so it is compatible with the strict production CSP, which disallows
// inline <script> blocks. Gated behind the analytics consent banner — we
// boot immediately if consent was previously granted, and listen for the
// consent-changed event so a mid-session grant loads PostHog live.
initPostHogIfConsented();
if (typeof globalThis.window !== "undefined") {
  globalThis.addEventListener(CONSENT_CHANGED_EVENT, () => {
    initPostHogIfConsented();
  });
}

const resizeObserverMessages = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

if (globalThis.window !== undefined) {
  const NativeResizeObserver = globalThis.ResizeObserver;

  if (NativeResizeObserver) {
    globalThis.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          globalThis.requestAnimationFrame(() => callback(entries, observer));
        });
      }
    };
  }

  globalThis.addEventListener(
    "error",
    (event) => {
      if (resizeObserverMessages.has(event.message)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
      }
      // Cross-origin iframe DataCloneError on PerformanceServerTiming is a
      // benign Chrome quirk — nothing the app can do about it, swallow it
      // so Sentry doesn't get flooded with noise.
      if (
        event.error instanceof DOMException &&
        event.error.name === "DataCloneError" &&
        event.message?.includes("PerformanceServerTiming")
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    },
    true,
  );

  // Recover from "stale chunk" errors that happen when a new build is
  // deployed while the tab has been sitting idle — the old HTML still
  // references hashed chunk names that no longer exist on the server.
  // Vite fires `vite:preloadError` for failed modulepreloads; the lazy
  // `import()` inside React.lazy surfaces as an unhandled rejection.
  // In both cases one hard reload (guarded against loops) recovers.
  globalThis.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForStaleChunk();
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason)) {
      reloadOnceForStaleChunk();
    }
  });
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

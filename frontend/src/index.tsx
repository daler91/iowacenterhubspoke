import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { isChunkLoadError, reloadOnceForStaleChunk } from "@/lib/chunkError";
import {
  CONSENT_CHANGED_EVENT,
  hasAnalyticsConsent,
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
      beforeSend(event) {
        if (event.request?.cookies) delete event.request.cookies;
        if (event.request?.headers) {
          delete event.request.headers['Authorization'];
          delete event.request.headers['X-CSRF-Token'];
        }
        return event;
      },
    });
  });
}

// PostHog analytics (opt-in via VITE_POSTHOG_KEY env var). Loaded from the
// bundle so it is compatible with the strict production CSP, which disallows
// inline <script> blocks. Gated behind the analytics consent banner — we
// boot immediately if consent was previously granted, and listen for the
// consent-changed event so a mid-session grant loads PostHog live.
// Deferred to idle so PostHog's ~50KB JS doesn't compete with React hydration
// for main-thread time; falls back to a short setTimeout on browsers without
// requestIdleCallback (Safari < 17).
let analyticsConsentListenerAttached = false;

const bootAnalytics = () => {
  if (globalThis.window !== undefined && !analyticsConsentListenerAttached) {
    globalThis.addEventListener(CONSENT_CHANGED_EVENT, () => {
      initPostHogIfConsented();
    });
    analyticsConsentListenerAttached = true;
  }
  if (!hasAnalyticsConsent()) return;
  initPostHogIfConsented();
};
if (typeof globalThis.requestIdleCallback === 'function') {
  // Drop the deadline on fast connections so PostHog initialises sooner
  // and we don't lose the first batch of events to the gap; fall back to
  // the conservative budget on slow / unknown connections so the bundle
  // doesn't muscle in on hydration.
  type ConnLike = { effectiveType?: string };
  const conn = (navigator as unknown as { connection?: ConnLike }).connection;
  const fast = conn?.effectiveType === '4g' || conn?.effectiveType === '5g';
  globalThis.requestIdleCallback(bootAnalytics, { timeout: fast ? 1500 : 3000 });
} else {
  setTimeout(bootAnalytics, 1000);
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

// Bookend performance marks for the app shell so we can measure how long
// the initial bundle takes to hydrate, before and after the lazy-load /
// tab-gating work lands. Paired with the `insights-tab-switch` measure in
// InsightsPage; both emit to whatever consumes User Timing entries
// (PostHog / Sentry / devtools).
const MARK_APP_SHELL_START = 'app-shell-bootstrap-start';
const MARK_APP_SHELL_READY = 'app-shell-ready';
if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
  try { performance.mark(MARK_APP_SHELL_START); } catch { /* older browsers */ }
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Mark the shell as ready once React has flushed its first commit. We use
// requestAnimationFrame inside requestIdleCallback so the measure reflects
// real paint + hydration, not just render-tree construction.
if (
  typeof performance !== 'undefined'
  && typeof performance.mark === 'function'
  && typeof performance.measure === 'function'
  && import.meta.env.MODE !== 'test'
) {
  const finish = () => {
    try {
      performance.mark(MARK_APP_SHELL_READY);
      performance.measure('app-shell-ready', MARK_APP_SHELL_START, MARK_APP_SHELL_READY);
    } catch { /* ignore missing start mark in fast-refresh reloads */ }
  };
  const onIdle = () => globalThis.requestAnimationFrame(finish);
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(onIdle, { timeout: 3000 });
  } else {
    setTimeout(onIdle, 500);
  }
}

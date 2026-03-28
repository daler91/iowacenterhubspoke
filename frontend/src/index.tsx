import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

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
      }
    },
    true,
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

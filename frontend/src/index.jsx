import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

const resizeObserverMessages = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

if (globalThis.window !== undefined) {
  const NativeResizeObserver = globalThis.ResizeObserver;

  if (NativeResizeObserver) {
    globalThis.ResizeObserver = class extends NativeResizeObserver {
      constructor(callback) {
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

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

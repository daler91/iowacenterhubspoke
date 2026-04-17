import React from "react";
import { AlertTriangle } from "lucide-react";
import {
  hasAttemptedChunkReload,
  isChunkLoadError,
  reloadOnceForStaleChunk,
} from "@/lib/chunkError";

interface ErrorBoundaryProps {
  readonly children: React.ReactNode;
  /**
   * When this prop changes, the boundary resets its error state. Wire this
   * to the current route path so a navigation clears a crashed screen
   * without a full reload.
   */
  readonly resetKey?: string | number;
  readonly fallback?: (args: {
    error: Error;
    reset: () => void;
  }) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // A failed lazy `import()` surfaces here when a new deploy rotated
    // chunk hashes out from under this still-open tab. A single hard
    // reload (guarded so we never loop) recovers.
    if (isChunkLoadError(error) && !hasAttemptedChunkReload()) {
      reloadOnceForStaleChunk();
    }
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Reset the boundary when the caller signals a new context (typically
    // the route path). This means a user who hits an error on /employees
    // and navigates to /calendar gets a fresh tree rather than a sticky
    // error screen.
    if (
      this.state.hasError &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    globalThis.location.reload();
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          reset: this.reset,
        });
      }
      const chunkError = isChunkLoadError(this.state.error);
      const heading = chunkError
        ? "This page was updated."
        : "Something went wrong.";
      const body = chunkError
        ? "A new version of the app is available. Reload to continue."
        : "We hit an unexpected error while loading this page. Try again, or reload if the problem sticks around.";
      const rawMessage = this.state.error?.message;
      return (
        <div
          className="p-6 m-4 border border-danger/30 bg-danger-soft rounded-lg"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="w-5 h-5 text-danger shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {heading}
              </h2>
              <p className="text-sm text-slate-600 dark:text-muted-foreground mt-1">
                {body}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {chunkError ? (
                  <button
                    type="button"
                    onClick={this.handleReload}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    Reload now
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={this.reset}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      Try again
                    </button>
                    <button
                      type="button"
                      onClick={this.handleReload}
                      className="px-4 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium rounded-lg transition-colors"
                    >
                      Reload page
                    </button>
                  </>
                )}
              </div>
              {!chunkError && rawMessage && (
                <details className="mt-4 text-xs text-slate-500 dark:text-muted-foreground">
                  <summary className="cursor-pointer">Show technical details</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px]">
                    {rawMessage}
                  </pre>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

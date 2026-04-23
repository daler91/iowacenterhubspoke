import { useEffect, useState } from "react";
import { getConsent, setConsent } from "@/lib/consent";

/**
 * Dismissible footer banner that captures the user's analytics-consent
 * choice. Shown the first time the app loads (until Accept or Reject is
 * clicked); hidden on every subsequent visit. PostHog (see ``lib/consent``)
 * listens for the consent-changed event so acceptance takes effect without
 * a page reload.
 */
export default function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(getConsent() === "pending");
  }, []);

  if (!open) return null;

  const accept = () => {
    setConsent("granted");
    setOpen(false);
  };

  const reject = () => {
    setConsent("rejected");
    setOpen(false);
  };

  return (
    <section
      aria-label="Cookie and analytics consent"
      // z-40 keeps the BulkActionBar (z-50) on top when both are
      // visible — a mid-task bulk action takes precedence over a
      // one-time consent prompt. On narrow phones push the banner up
      // so it clears the ~60px bulk bar even when both are stacked.
      className="fixed bottom-20 md:bottom-4 inset-x-4 md:inset-x-auto md:right-6 md:max-w-md z-40 rounded-lg border border-gray-200 bg-white dark:bg-gray-900 dark:border-gray-700 shadow-lg p-4"
    >
      <p className="text-sm text-slate-700 dark:text-slate-200">
        We use Sentry to detect errors and PostHog to understand product usage.
        Accept to enable analytics, or reject to load only error monitoring.
        See our{" "}
        <a
          href="/privacy"
          className="underline text-indigo-600 dark:text-indigo-400"
        >
          privacy policy
        </a>{" "}
        for details.
      </p>
      <div className="mt-3 flex gap-2 justify-end">
        <button
          type="button"
          onClick={reject}
          className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={accept}
          className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
        >
          Accept
        </button>
      </div>
    </section>
  );
}

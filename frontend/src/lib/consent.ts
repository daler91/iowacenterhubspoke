/**
 * Analytics consent helpers.
 *
 * PostHog (and any other analytics) must not run until the user grants
 * consent via the footer banner. This module centralizes the storage key,
 * the grant/deny lifecycle, and the imperative hooks that load PostHog
 * on the fly when consent is granted after page load.
 */

export type ConsentState = "granted" | "rejected" | "pending";

export const CONSENT_STORAGE_KEY = "analytics_consent";
export const CONSENT_CHANGED_EVENT = "analytics-consent-changed";

export function getConsent(): ConsentState {
  if (typeof window === "undefined") return "pending";
  const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
  if (raw === "granted" || raw === "rejected") return raw;
  return "pending";
}

export function setConsent(state: Exclude<ConsentState, "pending">): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSENT_STORAGE_KEY, state);
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: state }));
}

export function hasAnalyticsConsent(): boolean {
  return getConsent() === "granted";
}

export async function initPostHogIfConsented(): Promise<void> {
  if (!hasAnalyticsConsent()) return;
  const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
  if (!posthogKey) return;
  const posthogHost =
    import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";
  const { default: posthog } = await import("posthog-js");
  // posthog.init is idempotent on the same key; calling twice is safe.
  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: "identified_only",
    session_recording: {
      recordCrossOriginIframes: true,
      capturePerformance: false,
    },
  });
}

export async function resetPostHog(): Promise<void> {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.reset();
  } catch {
    // PostHog may not have loaded (e.g. consent was never granted); ignore.
  }
}

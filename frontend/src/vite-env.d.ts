/// <reference types="vite/client" />

/**
 * Document the runtime env vars exposed to the bundle via Vite's
 * ``import.meta.env``. Listed here so ``tsc --noEmit`` stops flagging
 * ``Property 'env' does not exist on type 'ImportMeta'``.
 *
 * Only variables prefixed with ``VITE_`` are exposed to client code —
 * that is Vite's security boundary, do not add server-only secrets here.
 * A few ``REACT_APP_*`` names are kept as legacy fallbacks for the old
 * CRA → Vite migration and are consumed in ``src/lib/api.ts``.
 */
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  /** Legacy CRA name kept as a fallback in ``api.ts``. Remove once callers migrate. */
  readonly REACT_APP_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

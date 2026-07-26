import { Link } from 'react-router-dom';

/**
 * Terminal 404 for unmatched client-side routes.
 *
 * The catch-all route used to render `MalformedAppLinkRedirect`, which returns
 * `null` for anything that isn't a mangled absolute URL — so any typo'd or
 * stale link produced a blank white screen with no message and no way back.
 */
export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-background px-6"
      role="alert"
    >
      <div className="text-center max-w-md">
        <p className="text-sm font-semibold text-hub" data-testid="not-found-code">404</p>
        <h1 className="mt-2 text-2xl font-display font-semibold text-foreground">
          Page not found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          That link doesn&apos;t point anywhere in HubSpoke. It may have been moved,
          or the address may be mistyped.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-hub px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-hub-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-2"
          data-testid="not-found-home-link"
        >
          Back to calendar
        </Link>
      </div>
    </div>
  );
}

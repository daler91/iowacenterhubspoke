import { Link } from "react-router-dom";

/**
 * Static privacy policy page. Describes the third parties we send data
 * to so users can make an informed analytics-consent choice from the
 * ConsentBanner. Keep this in sync with any new integration.
 */
export default function Privacy() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10 text-foreground">
      <nav className="mb-6 text-sm">
        <Link to="/" className="text-hub hover:underline">
          &larr; Back to app
        </Link>
      </nav>
      <h1 className="text-2xl font-bold mb-4">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Last updated: April 16, 2026
      </p>

      <section className="space-y-6 text-sm leading-6">
        <div>
          <h2 className="text-lg font-semibold mb-2">Data we collect</h2>
          <p>
            When you use this app we collect: your account email and name,
            the schedules, locations, classes, and projects you or your
            teammates create, and audit logs of actions you take. Partner
            contact records include name, email, and phone. If you connect
            Google or Outlook calendar integrations, we store the
            refresh tokens needed to sync events on your behalf, encrypted
            at rest.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Third parties</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Sentry</strong> &mdash; error monitoring. Request payloads
              are scrubbed of passwords, tokens, cookies, and other
              sensitive fields before transmission.
            </li>
            <li>
              <strong>PostHog</strong> &mdash; product analytics. Loaded only if
              you click <em>Accept</em> on the cookie banner. Without
              consent, no analytics events are sent. Logging out calls{" "}
              <code>posthog.reset()</code> so future events aren&rsquo;t
              attributed to the previous session.
            </li>
            <li>
              <strong>Google Calendar / Microsoft Outlook</strong> &mdash;
              used only when you explicitly connect an integration. We
              request the minimum OAuth scopes needed for event sync.
            </li>
            <li>
              <strong>Resend (SMTP)</strong> &mdash; outbound transactional
              email (invitations, password resets, partner magic links).
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Your rights</h2>
          <p>
            You can export a copy of the data associated with your account
            at{" "}
            <code>GET /api/v1/users/me/export</code> or request account
            deletion at{" "}
            <code>POST /api/v1/users/me/request-delete</code>. Deleted
            accounts are redacted from audit logs; deletion is reviewed by
            an administrator.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Analytics consent</h2>
          <p>
            Your choice is stored in <code>localStorage</code> under{" "}
            <code>analytics_consent</code>. Clear it from your browser to
            re-prompt the banner on the next page load.
          </p>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-2">Contact</h2>
          <p>
            Questions about this policy? Reach out to your system
            administrator.
          </p>
        </div>
      </section>
    </main>
  );
}

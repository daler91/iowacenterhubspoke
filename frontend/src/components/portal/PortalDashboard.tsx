/**
 * Partner portal shell: resolve the session, pick a section from the URL,
 * render the matching page.
 *
 * This module was 1,850 lines — seven page components, ~15 presentational
 * components, two data hooks and a dozen pure helpers, all in one file, with
 * 21 useState calls and no useCallback or memo anywhere. It is now split into
 * ./shared (pure helpers, constants, types), ./hooks (SWR data), ./components
 * (presentational) and ./pages (one per route section).
 */
import PortalShell from './PortalShell';
import {
  useEffect,
  type ReactNode,
} from 'react';
import {
  useLocation,
  useParams,
} from 'react-router-dom';
import {
  PageShell,
} from '../ui/page-shell';
import {
  describeApiError,
} from '../../lib/error-messages';
import {
  usePortalSession,
  usePortalWorkspace,
} from '../../hooks/usePortalData';
import {
  runPortalAsync,
} from './async';
import {
  LEGACY_PORTAL_TOKEN_KEY,
  routeSection,
} from './shared';
import {
  PortalLoading,
  PortalRecovery,
} from './components';
import {
  DocumentsPage,
  HomePage,
  MessagesPage,
  ProjectHubPage,
  ProjectsPage,
  SettingsPage,
  TasksPage,
} from './pages';


export default function PortalDashboard() {
  const { token: urlToken, projectId } = useParams<{ token?: string; projectId?: string }>();
  const token = urlToken || '';
  const location = useLocation();
  const section = routeSection(location.pathname, projectId);
  const { session, error: sessionError, isLoading: sessionLoading } = usePortalSession(token);
  const { workspace, error: workspaceError, isLoading: workspaceLoading, mutateWorkspace } = usePortalWorkspace(token);

  useEffect(() => {
    if (!token || sessionError) {
      sessionStorage.removeItem(LEGACY_PORTAL_TOKEN_KEY);
    }
  }, [sessionError, token]);

  if (!token || sessionError) {
    return <PortalRecovery />;
  }

  if ((sessionLoading && !session) || (workspaceLoading && !workspace && !session)) {
    return <PortalLoading />;
  }

  const org = workspace?.org ?? session?.org;
  const contact = workspace?.contact ?? session?.contact;

  if (!org || !contact) {
    return <PortalLoading />;
  }

  const refreshWorkspace = async () => {
    await mutateWorkspace();
  };

  let workspaceContent: ReactNode;
  if (workspaceError && !workspace) {
    workspaceContent = (
      <PageShell
        testId="portal-workspace-error"
        title="Partner Home"
        subtitle="Your partner workspace could not be loaded."
        status={{
          kind: 'error',
          error: { message: describeApiError(workspaceError, "We couldn't load your portal workspace.") },
          onRetry: () => {
            runPortalAsync(mutateWorkspace(), 'retry portal workspace');
          },
        }}
      />
    );
  } else if (workspace) {
    workspaceContent = (
      <>
        {section === 'home' && <HomePage workspace={workspace} token={token} />}
        {section === 'projects' && <ProjectsPage workspace={workspace} token={token} />}
        {section === 'project' && projectId && (
          <ProjectHubPage
            token={token}
            projectId={projectId}
            refreshWorkspace={refreshWorkspace}
          />
        )}
        {section === 'tasks' && (
          <TasksPage
            workspace={workspace}
            token={token}
            refreshWorkspace={refreshWorkspace}
          />
        )}
        {section === 'documents' && (
          <DocumentsPage
            workspace={workspace}
            token={token}
            refreshWorkspace={refreshWorkspace}
          />
        )}
        {section === 'messages' && <MessagesPage workspace={workspace} token={token} />}
        {section === 'settings' && <SettingsPage token={token} />}
      </>
    );
  } else {
    workspaceContent = (
      <PageShell
        testId="portal-workspace-loading"
        title="Partner Home"
        subtitle="Loading your partner workspace..."
        status={{ kind: 'loading', variant: 'cards' }}
      />
    );
  }

  return (
    <PortalShell
      token={token}
      org={org}
      contact={contact}
      activeSection={section === 'project' ? 'projects' : section}
    >
      {workspaceContent}
    </PortalShell>
  );
}

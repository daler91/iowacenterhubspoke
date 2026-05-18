import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import '@testing-library/jest-dom';

import { portalAPI } from '../../lib/coordination-api';
import PortalDashboard from './PortalDashboard';

let mockRouteToken = 'bad-token';
let mockProjectId: string | undefined;
let mockPathname = '/portal/bad-token';
const mockNavigate = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('react-router-dom', () => ({
  useParams: () => ({ token: mockRouteToken, projectId: mockProjectId }),
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: mockPathname }),
}));

jest.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: jest.fn() }),
}));

jest.mock('../../lib/coordination-api', () => ({
  portalAPI: {
    verify: jest.fn(),
    workspace: jest.fn(),
    projectWorkspace: jest.fn(),
    requestLink: jest.fn(),
    bulkProjectTasks: jest.fn(),
    updateTask: jest.fn(),
    projectDocuments: jest.fn(),
    previewDocument: jest.fn(),
    downloadDocument: jest.fn(),
    uploadDocument: jest.fn(),
    sendMessage: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

jest.mock('./PortalNotificationsPanel', () => () => null);
jest.mock('../NotificationPreferences', () => () => <div>Notification settings form</div>);

const mockedPortalAPI = portalAPI as jest.Mocked<typeof portalAPI>;

const org = {
  id: 'org-1',
  name: 'Story City Library',
  community: 'Story City',
  venue_details: {},
  co_branding: '',
  status: 'active',
  notes: '',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
};

const contact = {
  id: 'contact-1',
  partner_org_id: 'org-1',
  name: 'Pat Partner',
  email: 'pat@example.com',
  phone: '',
  role: 'Director',
  is_primary: true,
  created_at: '2026-04-01T00:00:00Z',
};

const project = {
  id: 'project-1',
  title: 'Spring Workshop',
  event_format: 'workshop',
  partner_org_id: 'org-1',
  event_date: '2026-05-15T15:00:00Z',
  phase: 'planning',
  community: 'Story City',
  venue_name: 'Main Room',
  registration_count: 0,
  notes: '',
  created_at: '2026-04-01T00:00:00Z',
  updated_at: '2026-04-01T00:00:00Z',
  created_by: 'user-1',
  portal_task_counts: {
    total: 2,
    completed: 0,
    open: 2,
    overdue: 0,
  },
};

const tasks = [
  {
    id: 'task-1',
    project_id: 'project-1',
    title: 'Confirm room layout',
    phase: 'planning',
    owner: 'partner',
    due_date: '2026-05-01T00:00:00Z',
    status: 'to_do',
    completed: false,
    sort_order: 1,
    details: 'Send the preferred seating plan.',
    created_at: '2026-04-01T00:00:00Z',
  },
  {
    id: 'task-2',
    project_id: 'project-1',
    title: 'Share flyer',
    phase: 'promotion',
    owner: 'both',
    due_date: '2026-05-03T00:00:00Z',
    status: 'in_progress',
    completed: false,
    sort_order: 2,
    details: '',
    created_at: '2026-04-01T00:00:00Z',
  },
];

function workspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    org,
    contact,
    summary: {
      active_projects: 1,
      upcoming_classes: 1,
      open_tasks: 2,
      overdue_tasks: 0,
      classes_hosted: 0,
    },
    projects: [project],
    needs_attention: [],
    org_documents: [],
    unread_notifications: 0,
    recent_activity: [],
    ...overrides,
  };
}

function projectWorkspacePayload(overrides: Record<string, unknown> = {}) {
  return {
    org,
    contact,
    project,
    tasks,
    documents: [],
    messages: [],
    members: [],
    recent_activity: [],
    ...overrides,
  };
}

function renderPortal() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PortalDashboard />
    </SWRConfig>,
  );
}

describe('PortalDashboard link recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteToken = 'bad-token';
    mockProjectId = undefined;
    mockPathname = '/portal/bad-token';
    sessionStorage.clear();
    mockedPortalAPI.verify.mockRejectedValue({ response: { status: 401 } });
    mockedPortalAPI.workspace.mockRejectedValue({ response: { status: 401 } });
    mockedPortalAPI.requestLink.mockResolvedValue({
      data: { message: 'If that email is registered, a link has been sent.' },
    } as Awaited<ReturnType<typeof portalAPI.requestLink>>);
  });

  it('keeps partners on the portal page and lets them request a new link', async () => {
    sessionStorage.setItem('portal_session_token', 'stale-token');

    renderPortal();

    expect(await screen.findByText('Request a new portal link')).toBeInTheDocument();
    expect(screen.getByText('This portal link is invalid or expired.')).toBeInTheDocument();
    expect(sessionStorage.getItem('portal_session_token')).toBeNull();

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'partner@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send new link/i }));

    await waitFor(() => {
      expect(mockedPortalAPI.requestLink).toHaveBeenCalledWith('partner@example.com');
    });
    expect(
      screen.getByText('If that email is registered, a new link has been sent.'),
    ).toBeInTheDocument();
  });
});

describe('PortalDashboard route pages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteToken = 'good-token';
    mockProjectId = undefined;
    mockPathname = '/portal/good-token';
    sessionStorage.clear();
    mockedPortalAPI.verify.mockResolvedValue({ data: { org, contact } } as Awaited<ReturnType<typeof portalAPI.verify>>);
    mockedPortalAPI.workspace.mockResolvedValue({ data: workspacePayload() } as Awaited<ReturnType<typeof portalAPI.workspace>>);
    mockedPortalAPI.projectWorkspace.mockResolvedValue({ data: projectWorkspacePayload() } as Awaited<ReturnType<typeof portalAPI.projectWorkspace>>);
    mockedPortalAPI.bulkProjectTasks.mockResolvedValue({
      data: { items: { 'project-1': tasks } },
    } as Awaited<ReturnType<typeof portalAPI.bulkProjectTasks>>);
    mockedPortalAPI.projectDocuments.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    mockedPortalAPI.updateTask.mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof portalAPI.updateTask>>);
    mockedPortalAPI.sendMessage.mockResolvedValue({ data: { id: 'message-1' } } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);
  });

  it('renders a project-first portal home inside the partner shell', async () => {
    renderPortal();

    expect(await screen.findByTestId('portal-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Partner Home' })).toBeInTheDocument();
    expect(screen.getByText('Spring Workshop')).toBeInTheDocument();
    expect(screen.getByTestId('portal-nav-projects')).toBeInTheDocument();
  });

  it('keeps task due dates on their calendar day and lets partners switch to a board', async () => {
    mockPathname = '/portal/good-token/tasks';

    renderPortal();

    await waitFor(() => {
      expect(mockedPortalAPI.bulkProjectTasks).toHaveBeenCalledWith(['project-1'], 'good-token');
    });

    expect(screen.getByText('5/1/2026')).toBeInTheDocument();
    expect(screen.getByText('5/3/2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /board/i }));

    expect(screen.getByRole('heading', { name: 'To Do' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In Progress' })).toBeInTheDocument();
    expect(screen.getByText('Confirm room layout')).toBeInTheDocument();
    expect(screen.getByText('Share flyer')).toBeInTheDocument();
  });

  it('shows fallback delivery summary when API omits notification_summary', async () => {
    mockPathname = '/portal/good-token/messages';
    mockedPortalAPI.sendMessage.mockResolvedValue({
      data: {
        id: 'msg-1',
        body: 'hello @pat',
        mentions: [{ id: 'contact-1', kind: 'partner' }],
      },
    } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);

    renderPortal();

    await waitFor(() => {
      expect(mockedPortalAPI.projectWorkspace).toHaveBeenCalledWith('project-1', 'good-token');
    });

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'hello @pat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    expect(await screen.findByText('Last delivery')).toBeInTheDocument();
    expect(screen.getByText('Mentions resolved/notified: 1 / 0')).toBeInTheDocument();
  });

  it('shows actionable retry states for task, document, and message load failures', async () => {
    mockPathname = '/portal/good-token/tasks';
    mockedPortalAPI.bulkProjectTasks
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { items: { 'project-1': [] } } } as Awaited<ReturnType<typeof portalAPI.bulkProjectTasks>>);

    const { rerender } = renderPortal();

    expect(await screen.findByText('Tasks could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry tasks/i }));
    await waitFor(() => expect(mockedPortalAPI.bulkProjectTasks).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No tasks assigned to you')).toBeInTheDocument();

    mockPathname = '/portal/good-token/documents';
    mockedPortalAPI.projectDocuments
      .mockRejectedValueOnce(new Error('documents unavailable'))
      .mockResolvedValueOnce({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PortalDashboard />
      </SWRConfig>,
    );
    expect(await screen.findByText('Documents could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry documents/i }));
    await waitFor(() => expect(mockedPortalAPI.projectDocuments).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No shared documents')).toBeInTheDocument();

    mockPathname = '/portal/good-token/messages';
    mockedPortalAPI.projectWorkspace
      .mockRejectedValueOnce(new Error('messages unavailable'))
      .mockResolvedValueOnce({ data: projectWorkspacePayload() } as Awaited<ReturnType<typeof portalAPI.projectWorkspace>>);
    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PortalDashboard />
      </SWRConfig>,
    );
    expect(await screen.findByText('Messages could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry messages/i }));
    await waitFor(() => expect(mockedPortalAPI.projectWorkspace).toHaveBeenCalled());
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });

  it('guards rapid task toggles while the update is pending', async () => {
    mockPathname = '/portal/good-token/tasks';
    let resolveUpdate!: (value: Awaited<ReturnType<typeof portalAPI.updateTask>>) => void;
    mockedPortalAPI.updateTask.mockReturnValue(
      new Promise((resolve) => { resolveUpdate = resolve; }) as ReturnType<typeof portalAPI.updateTask>,
    );

    renderPortal();

    const toggle = await screen.findByRole('button', { name: /mark complete: confirm room layout/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    fireEvent.click(toggle);

    expect(mockedPortalAPI.updateTask).toHaveBeenCalledTimes(1);
    resolveUpdate({ data: {} } as Awaited<ReturnType<typeof portalAPI.updateTask>>);
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { portalAPI } from '../../lib/coordination-api';
import PortalDashboard from './PortalDashboard';

let mockRouteToken = 'bad-token';
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('react-router-dom', () => ({
  useParams: () => ({ token: mockRouteToken }),
  useNavigate: () => jest.fn(),
}));

jest.mock('../../lib/coordination-api', () => ({
  portalAPI: {
    verify: jest.fn(),
    dashboard: jest.fn(),
    requestLink: jest.fn(),
    bulkProjectTasks: jest.fn(),
    completeTask: jest.fn(),
    updateTask: jest.fn(),
    taskDetail: jest.fn(),
    projectDocuments: jest.fn(),
    previewDocument: jest.fn(),
    downloadDocument: jest.fn(),
    projectMessages: jest.fn(),
    sendMessage: jest.fn(),
    projectMembers: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

jest.mock('./PortalNotificationsPanel', () => () => null);

const mockedPortalAPI = portalAPI as jest.Mocked<typeof portalAPI>;

describe('PortalDashboard link recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteToken = 'bad-token';
    sessionStorage.clear();
    mockedPortalAPI.verify.mockRejectedValue({ response: { status: 401 } });
    mockedPortalAPI.requestLink.mockResolvedValue({
      data: { message: 'If that email is registered, a link has been sent.' },
    } as Awaited<ReturnType<typeof portalAPI.requestLink>>);
  });

  it('keeps partners on the portal page and lets them request a new link', async () => {
    sessionStorage.setItem('portal_session_token', 'stale-token');

    render(<PortalDashboard />);

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

describe('PortalDashboard task board and message confirmations', () => {
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
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteToken = 'good-token';
    sessionStorage.clear();
    mockedPortalAPI.verify.mockResolvedValue({ data: { org, contact } } as Awaited<ReturnType<typeof portalAPI.verify>>);
    mockedPortalAPI.dashboard.mockResolvedValue({
      data: {
        upcoming_classes: 1,
        open_tasks: 2,
        overdue_tasks: 0,
        classes_hosted: 0,
        projects: [project],
      },
    } as Awaited<ReturnType<typeof portalAPI.dashboard>>);
    mockedPortalAPI.bulkProjectTasks.mockResolvedValue({
      data: {
        items: {
          'project-1': [
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
          ],
        },
      },
    } as Awaited<ReturnType<typeof portalAPI.bulkProjectTasks>>);
    mockedPortalAPI.projectMessages.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMessages>>);
    mockedPortalAPI.projectMembers.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMembers>>);
    mockedPortalAPI.projectDocuments.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    mockedPortalAPI.updateTask.mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof portalAPI.updateTask>>);
  });

  it('keeps task due dates on their calendar day and lets partners switch to a Kanban board', async () => {
    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Your Tasks' }));
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
    mockedPortalAPI.sendMessage.mockResolvedValue({
      data: {
        id: 'msg-1',
        body: 'hello @pat',
        mentions: [{ id: 'contact-1', kind: 'partner' }],
      },
    } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);

    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Messages' }));
    await waitFor(() => {
      expect(mockedPortalAPI.projectMessages).toHaveBeenCalledWith('project-1', 'good-token');
    });

    fireEvent.change(screen.getByPlaceholderText(/type a message/i), {
      target: { value: 'hello @pat' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    expect(await screen.findByText('Last delivery')).toBeInTheDocument();
    expect(screen.getByText('Mentions resolved/notified: 1 / 0')).toBeInTheDocument();
  });

  it('shows an actionable task retry state instead of an empty list after load failure', async () => {
    mockedPortalAPI.bulkProjectTasks
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { items: { 'project-1': [] } } } as Awaited<ReturnType<typeof portalAPI.bulkProjectTasks>>);

    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Your Tasks' }));

    expect(await screen.findByText('Tasks could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No tasks assigned to you')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry tasks/i }));

    await waitFor(() => {
      expect(mockedPortalAPI.bulkProjectTasks).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No tasks assigned to you')).toBeInTheDocument();
  });

  it('shows document and message load errors with retry actions', async () => {
    mockedPortalAPI.projectDocuments
      .mockRejectedValueOnce(new Error('documents unavailable'))
      .mockResolvedValueOnce({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    mockedPortalAPI.projectMessages
      .mockRejectedValueOnce(new Error('messages unavailable'))
      .mockResolvedValueOnce({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMessages>>);

    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(await screen.findByText('Documents could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry documents/i }));
    await waitFor(() => {
      expect(mockedPortalAPI.projectDocuments).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No shared documents')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    expect(await screen.findByText('Messages could not be loaded.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry messages/i }));
    await waitFor(() => {
      expect(mockedPortalAPI.projectMessages).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No messages yet')).toBeInTheDocument();
  });

  it('guards rapid task toggles while the update is pending', async () => {
    let resolveUpdate!: (value: Awaited<ReturnType<typeof portalAPI.updateTask>>) => void;
    mockedPortalAPI.updateTask.mockReturnValue(
      new Promise((resolve) => { resolveUpdate = resolve; }) as ReturnType<typeof portalAPI.updateTask>,
    );

    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Your Tasks' }));
    const toggle = await screen.findByRole('button', { name: /mark complete: confirm room layout/i });

    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    fireEvent.click(toggle);

    expect(mockedPortalAPI.updateTask).toHaveBeenCalledTimes(1);
    resolveUpdate({ data: {} } as Awaited<ReturnType<typeof portalAPI.updateTask>>);
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it('guards send while pending and exposes document icon button names', async () => {
    mockedPortalAPI.projectDocuments.mockResolvedValue({
      data: {
        items: [{
          id: 'doc-1',
          project_id: 'project-1',
          filename: 'partner-packet.pdf',
          file_type: 'pdf',
          file_path: 'partner-packet.pdf',
          visibility: 'shared',
          uploaded_by: 'user-1',
          uploaded_at: '2026-04-01T00:00:00Z',
          version: 1,
        }],
      },
    } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    let resolveSend!: (value: Awaited<ReturnType<typeof portalAPI.sendMessage>>) => void;
    mockedPortalAPI.sendMessage.mockReturnValue(
      new Promise((resolve) => { resolveSend = resolve; }) as ReturnType<typeof portalAPI.sendMessage>,
    );

    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Documents' }));
    expect(await screen.findByRole('button', { name: /preview partner-packet.pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download partner-packet.pdf/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Messages' }));
    await waitFor(() => {
      expect(mockedPortalAPI.projectMessages).toHaveBeenCalledWith('project-1', 'good-token');
    });
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello team' },
    });
    const send = screen.getByRole('button', { name: /send message/i });
    fireEvent.click(send);
    await waitFor(() => expect(send).toBeDisabled());
    fireEvent.click(send);
    expect(mockedPortalAPI.sendMessage).toHaveBeenCalledTimes(1);
    resolveSend({ data: { id: 'msg-1', mentions: [] } } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);
  });

  it('confirms how many recipients were notified when API returns notification_summary', async () => {
    mockedPortalAPI.sendMessage.mockResolvedValue({
      data: {
        id: 'message-1',
        notification_summary: {
          mentions_requested: 0,
          mentions_resolved: 0,
          message_recipients_notified: 2,
          mention_recipients_notified: 0,
        },
      },
    } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);

    render(<PortalDashboard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Messages' }));
    await waitFor(() => {
      expect(mockedPortalAPI.projectMessages).toHaveBeenCalledWith('project-1', 'good-token');
    });

    fireEvent.change(screen.getByPlaceholderText(/type a message/i), {
      target: { value: 'Hello team' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Message sent. Notifications sent to 2 recipients.',
      );
    });
  });
});

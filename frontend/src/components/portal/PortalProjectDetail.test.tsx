import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { portalAPI } from '../../lib/coordination-api';
import PortalProjectDetail from './PortalProjectDetail';

const mockNavigate = jest.fn();
const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'portal-token', projectId: 'project-1' }),
  useNavigate: () => mockNavigate,
}));

jest.mock('../../lib/coordination-api', () => ({
  portalAPI: {
    verify: jest.fn(),
    projects: jest.fn(),
    projectTasks: jest.fn(),
    projectDocuments: jest.fn(),
    projectMessages: jest.fn(),
    projectMembers: jest.fn(),
    updateTask: jest.fn(),
    sendMessage: jest.fn(),
    previewDocument: jest.fn(),
    downloadDocument: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

jest.mock('./PortalLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('../coordination/AttachmentPreviewDialog', () => ({
  __esModule: true,
  default: () => null,
}));

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
};

describe('PortalProjectDetail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedPortalAPI.verify.mockResolvedValue({ data: { org, contact } } as Awaited<ReturnType<typeof portalAPI.verify>>);
    mockedPortalAPI.projects.mockResolvedValue({ data: { items: [project] } } as Awaited<ReturnType<typeof portalAPI.projects>>);
    mockedPortalAPI.projectTasks.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectTasks>>);
    mockedPortalAPI.projectDocuments.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    mockedPortalAPI.projectMessages.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMessages>>);
    mockedPortalAPI.projectMembers.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMembers>>);
    mockedPortalAPI.sendMessage.mockResolvedValue({ data: { id: 'msg-1' } } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);
  });

  it('shows retryable section errors instead of silent empty states', async () => {
    mockedPortalAPI.projectTasks
      .mockRejectedValueOnce(new Error('task failure'))
      .mockResolvedValueOnce({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectTasks>>);
    mockedPortalAPI.projectDocuments
      .mockRejectedValueOnce(new Error('document failure'))
      .mockResolvedValueOnce({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectDocuments>>);
    mockedPortalAPI.projectMessages
      .mockRejectedValueOnce(new Error('message failure'))
      .mockResolvedValueOnce({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMessages>>);

    render(<PortalProjectDetail />);

    expect(await screen.findByText('Tasks could not be loaded.')).toBeInTheDocument();
    expect(await screen.findByText('Documents could not be loaded.')).toBeInTheDocument();
    expect(await screen.findByText('Messages could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No tasks assigned to this project')).not.toBeInTheDocument();
    expect(screen.queryByText('No shared documents for this project')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry tasks/i }));
    fireEvent.click(screen.getByRole('button', { name: /retry documents/i }));
    fireEvent.click(screen.getByRole('button', { name: /retry messages/i }));

    await waitFor(() => {
      expect(mockedPortalAPI.projectTasks).toHaveBeenCalledTimes(2);
      expect(mockedPortalAPI.projectDocuments).toHaveBeenCalledTimes(2);
      expect(mockedPortalAPI.projectMessages).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('No tasks assigned to this project')).toBeInTheDocument();
    expect(await screen.findByText('No shared documents for this project')).toBeInTheDocument();
    expect(await screen.findByText('No messages yet for this project')).toBeInTheDocument();
  });

  it('guards project message sending while pending', async () => {
    let resolveSend!: (value: Awaited<ReturnType<typeof portalAPI.sendMessage>>) => void;
    mockedPortalAPI.sendMessage.mockReturnValue(
      new Promise((resolve) => { resolveSend = resolve; }) as ReturnType<typeof portalAPI.sendMessage>,
    );

    render(<PortalProjectDetail />);

    const messageInput = await screen.findByLabelText('Message this project');
    fireEvent.change(messageInput, { target: { value: 'Can you review this?' } });
    const send = screen.getByRole('button', { name: /send project message/i });

    fireEvent.click(send);
    await waitFor(() => expect(send).toBeDisabled());
    fireEvent.click(send);
    expect(mockedPortalAPI.sendMessage).toHaveBeenCalledTimes(1);
    resolveSend({ data: { id: 'msg-1' } } as Awaited<ReturnType<typeof portalAPI.sendMessage>>);
  });
});

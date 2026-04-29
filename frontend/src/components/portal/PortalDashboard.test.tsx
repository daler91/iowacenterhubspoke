import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { portalAPI } from '../../lib/coordination-api';
import PortalDashboard from './PortalDashboard';

jest.mock('react-router-dom', () => ({
  useParams: () => ({ token: 'bad-token' }),
}));

jest.mock('../../lib/coordination-api', () => ({
  portalAPI: {
    verify: jest.fn(),
    dashboard: jest.fn(),
    requestLink: jest.fn(),
    projectMessages: jest.fn(),
    projectMembers: jest.fn(),
    sendMessage: jest.fn(),
  },
}));

const mockedPortalAPI = portalAPI as jest.Mocked<typeof portalAPI>;

describe('PortalDashboard link recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

describe('PortalDashboard message delivery summary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();

    mockedPortalAPI.verify.mockResolvedValue({
      data: {
        org: { id: 'org-1', name: 'Story City Library', city: 'Story City' },
        contact: { id: 'contact-1', name: 'Pat Partner' },
      },
    } as Awaited<ReturnType<typeof portalAPI.verify>>);

    mockedPortalAPI.dashboard.mockResolvedValue({
      data: {
        upcoming_classes: 1,
        open_tasks: 1,
        overdue_tasks: 0,
        classes_hosted: 1,
        projects: [
          {
            id: 'project-1',
            title: 'Spring Workshop',
            phase: 'planning',
            event_date: new Date().toISOString(),
            venue_name: 'Main Hall',
          },
        ],
      },
    } as Awaited<ReturnType<typeof portalAPI.dashboard>>);

    mockedPortalAPI.projectMessages.mockResolvedValue({
      data: { items: [] },
    } as Awaited<ReturnType<typeof portalAPI.projectMessages>>);

    mockedPortalAPI.projectMembers.mockResolvedValue({
      data: { items: [] },
    } as Awaited<ReturnType<typeof portalAPI.projectMembers>>);
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

    const input = await screen.findByPlaceholderText('Type a message — @ to mention...');
    fireEvent.change(input, { target: { value: 'hello @pat' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));

    expect(await screen.findByText('Last delivery')).toBeInTheDocument();
    expect(screen.getByText('Mentions resolved/notified: 1 / 0')).toBeInTheDocument();
  });
});

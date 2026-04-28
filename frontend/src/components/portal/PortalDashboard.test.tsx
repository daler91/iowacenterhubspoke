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

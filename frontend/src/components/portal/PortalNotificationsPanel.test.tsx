import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { portalAPI } from '../../lib/coordination-api';
import PortalNotificationsPanel from './PortalNotificationsPanel';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('../../lib/coordination-api', () => ({
  portalAPI: {
    inbox: jest.fn(),
    markInboxRead: jest.fn(),
    dismissInbox: jest.fn(),
  },
}));

const mockedPortalAPI = portalAPI as jest.Mocked<typeof portalAPI>;

function mockPortalInbox(link: string) {
  mockedPortalAPI.inbox.mockResolvedValue({
    data: {
      items: [{
        id: 'notification-1',
        type_key: 'project.message_mentioned',
        title: 'Mentioned you',
        body: 'Open the project.',
        severity: 'info',
        link,
        read_at: null,
        created_at: '2026-05-18T12:00:00Z',
      }],
    },
  } as Awaited<ReturnType<typeof portalAPI.inbox>>);
  mockedPortalAPI.markInboxRead.mockResolvedValue(
    { data: { ok: true } } as Awaited<ReturnType<typeof portalAPI.markInboxRead>>,
  );
}

async function openAndClickPortalNotification() {
  render(<PortalNotificationsPanel token="portal-token" />);
  fireEvent.click(screen.getByTestId('portal-notifications-bell'));
  const title = await screen.findByText('Mentioned you');
  fireEvent.click(title.closest('button') as HTMLButtonElement);
  await waitFor(() => expect(mockedPortalAPI.markInboxRead).toHaveBeenCalledWith('portal-token', 'notification-1'));
}

describe('PortalNotificationsPanel links', () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('maps app-owned project links to the active portal route', async () => {
    mockPortalInbox('https://www.theiowacenter-hub.org/coordination/projects/project-1');

    await openAndClickPortalNotification();

    expect(mockNavigate).toHaveBeenCalledWith('/portal/portal-token/projects/project-1');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('repairs mangled app-owned project links before portal routing', async () => {
    mockPortalInbox('/https:/www.theiowacenter-hub.org/coordination/projects/project-2');

    await openAndClickPortalNotification();

    expect(mockNavigate).toHaveBeenCalledWith('/portal/portal-token/projects/project-2');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('keeps external links external', async () => {
    mockPortalInbox('https://example.org/resource');

    await openAndClickPortalNotification();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('https://example.org/resource', '_blank', 'noopener,noreferrer');
  });
});

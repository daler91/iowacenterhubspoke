import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { notificationsAPI } from '../lib/api';
import NotificationsPanel from './NotificationsPanel';

const mockNavigate = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

jest.mock('../lib/api', () => ({
  notificationsAPI: {
    getAll: jest.fn(),
    getInbox: jest.fn(),
    markRead: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    markAllRead: jest.fn(),
  },
}));

const mockedNotificationsAPI = notificationsAPI as jest.Mocked<typeof notificationsAPI>;

function mockInbox(link: string) {
  mockedNotificationsAPI.getAll.mockResolvedValue(
    { data: [] } as Awaited<ReturnType<typeof notificationsAPI.getAll>>,
  );
  mockedNotificationsAPI.getInbox.mockResolvedValue({
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
  } as Awaited<ReturnType<typeof notificationsAPI.getInbox>>);
  mockedNotificationsAPI.markRead.mockResolvedValue(
    { data: { ok: true } } as Awaited<ReturnType<typeof notificationsAPI.markRead>>,
  );
}

async function openAndClickNotification() {
  render(<NotificationsPanel />);
  fireEvent.click(screen.getByTestId('notifications-bell'));
  const title = await screen.findByText('Mentioned you');
  fireEvent.click(title.closest('button') as HTMLButtonElement);
  await waitFor(() => expect(mockedNotificationsAPI.markRead).toHaveBeenCalledWith('notification-1'));
}

describe('NotificationsPanel links', () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('navigates app-owned absolute notification links as SPA paths', async () => {
    mockInbox('https://www.theiowacenter-hub.org/coordination/projects/project-1');

    await openAndClickNotification();

    expect(mockNavigate).toHaveBeenCalledWith('/coordination/projects/project-1');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('repairs already-mangled stored notification links before navigating', async () => {
    mockInbox('/https:/www.theiowacenter-hub.org/coordination/projects/project-2');

    await openAndClickNotification();

    expect(mockNavigate).toHaveBeenCalledWith('/coordination/projects/project-2');
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens truly external notification links in a new tab', async () => {
    mockInbox('https://example.org/resource');

    await openAndClickNotification();

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(openSpy).toHaveBeenCalledWith('https://example.org/resource', '_blank', 'noopener,noreferrer');
  });
});

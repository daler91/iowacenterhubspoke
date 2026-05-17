import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { portalAPI } from '../../lib/coordination-api';
import PortalTaskDetailModal from './PortalTaskDetailModal';

const mockToastError = jest.fn();
const mockToastSuccess = jest.fn();

jest.mock('../../lib/coordination-api', () => ({
  portalAPI: {
    taskDetail: jest.fn(),
    taskAttachments: jest.fn(),
    taskComments: jest.fn(),
    projectMembers: jest.fn(),
    updateTask: jest.fn(),
    uploadTaskAttachment: jest.fn(),
    previewTaskAttachment: jest.fn(),
    downloadTaskAttachment: jest.fn(),
    postTaskComment: jest.fn(),
  },
}));

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

jest.mock('../coordination/AttachmentPreviewDialog', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../coordination/TaskDetailModal', () => ({
  ConversationsPanel: () => <div data-testid="comments-panel" />,
}));

const mockedPortalAPI = portalAPI as jest.Mocked<typeof portalAPI>;

const task = {
  id: 'task-1',
  project_id: 'project-1',
  title: 'Gather invoice',
  phase: 'planning',
  owner: 'partner',
  due_date: '2026-05-01T00:00:00Z',
  status: 'to_do',
  completed: false,
  sort_order: 1,
  details: 'Upload the invoice.',
  description: 'Upload the latest invoice.',
  created_at: '2026-04-01T00:00:00Z',
} as const;

const attachment = {
  id: 'att-1',
  task_id: 'task-1',
  project_id: 'project-1',
  filename: 'invoice.pdf',
  file_type: 'pdf',
  file_path: 'invoice.pdf',
  uploaded_by: 'contact-1',
  uploaded_at: '2026-04-01T00:00:00Z',
  version: 1,
} as const;

describe('PortalTaskDetailModal', () => {
  const onRefresh = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    onRefresh.mockResolvedValue(undefined);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:portal-attachment'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(),
    });
    HTMLAnchorElement.prototype.click = jest.fn();
    mockedPortalAPI.taskDetail.mockResolvedValue({ data: task } as Awaited<ReturnType<typeof portalAPI.taskDetail>>);
    mockedPortalAPI.taskAttachments.mockResolvedValue({ data: { items: [attachment] } } as Awaited<ReturnType<typeof portalAPI.taskAttachments>>);
    mockedPortalAPI.taskComments.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.taskComments>>);
    mockedPortalAPI.projectMembers.mockResolvedValue({ data: { items: [] } } as Awaited<ReturnType<typeof portalAPI.projectMembers>>);
    mockedPortalAPI.updateTask.mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof portalAPI.updateTask>>);
    mockedPortalAPI.uploadTaskAttachment.mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof portalAPI.uploadTaskAttachment>>);
    mockedPortalAPI.previewTaskAttachment.mockResolvedValue({
      data: new Blob(['preview']),
      headers: { 'content-type': 'application/pdf' },
    } as unknown as Awaited<ReturnType<typeof portalAPI.previewTaskAttachment>>);
    mockedPortalAPI.downloadTaskAttachment.mockResolvedValue({
      data: new Blob(['download']),
      headers: { 'content-type': 'application/pdf' },
    } as unknown as Awaited<ReturnType<typeof portalAPI.downloadTaskAttachment>>);
  });

  it('stops the spinner and offers retry when task detail loading fails', async () => {
    mockedPortalAPI.taskDetail.mockRejectedValueOnce(new Error('unavailable'));

    render(
      <PortalTaskDetailModal
        open={true}
        onOpenChange={jest.fn()}
        projectId="project-1"
        taskId="task-1"
        token="portal-token"
        onRefresh={onRefresh}
      />,
    );

    expect(await screen.findByText('Task details could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText(/Loading details/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry task details/i }));

    expect(await screen.findByText('Gather invoice')).toBeInTheDocument();
    expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
  });

  it('exposes attachment action names and guards download while pending', async () => {
    let resolveDownload!: (value: Awaited<ReturnType<typeof portalAPI.downloadTaskAttachment>>) => void;
    mockedPortalAPI.downloadTaskAttachment.mockReturnValue(
      new Promise((resolve) => { resolveDownload = resolve; }) as ReturnType<typeof portalAPI.downloadTaskAttachment>,
    );

    render(
      <PortalTaskDetailModal
        open={true}
        onOpenChange={jest.fn()}
        projectId="project-1"
        taskId="task-1"
        token="portal-token"
        onRefresh={onRefresh}
      />,
    );

    expect(await screen.findByRole('button', { name: /preview invoice.pdf/i })).toBeInTheDocument();
    const download = screen.getByRole('button', { name: /download invoice.pdf/i });

    fireEvent.click(download);
    await waitFor(() => expect(download).toBeDisabled());
    fireEvent.click(download);

    expect(mockedPortalAPI.downloadTaskAttachment).toHaveBeenCalledTimes(1);
    resolveDownload({ data: new Blob(['download']) } as Awaited<ReturnType<typeof portalAPI.downloadTaskAttachment>>);
    await waitFor(() => expect(download).not.toBeDisabled());
  });

  it('disables attachment upload while a file is pending', async () => {
    let resolveUpload!: (value: Awaited<ReturnType<typeof portalAPI.uploadTaskAttachment>>) => void;
    mockedPortalAPI.uploadTaskAttachment.mockReturnValue(
      new Promise((resolve) => { resolveUpload = resolve; }) as ReturnType<typeof portalAPI.uploadTaskAttachment>,
    );

    render(
      <PortalTaskDetailModal
        open={true}
        onOpenChange={jest.fn()}
        projectId="project-1"
        taskId="task-1"
        token="portal-token"
        onRefresh={onRefresh}
      />,
    );

    await screen.findByText('Gather invoice');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['invoice'], 'new-invoice.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText('Uploading...')).toBeInTheDocument();
    expect(fileInput).toBeDisabled();
    expect(mockedPortalAPI.uploadTaskAttachment).toHaveBeenCalledTimes(1);
    resolveUpload({ data: {} } as Awaited<ReturnType<typeof portalAPI.uploadTaskAttachment>>);
  });
});

/**
 * Pure helpers, constants and types shared across the partner portal.
 *
 * Extracted from PortalDashboard.tsx, which had grown to 1,850 lines holding
 * seven page components, ~15 presentational components, two hooks and a dozen
 * helpers in one module. Nothing here touches React state or the network, so
 * it can be unit-tested directly and imported without pulling in the whole
 * dashboard.
 */
import type { Dispatch, SetStateAction } from 'react';
import {
  type Message,
  type PortalWorkspace,
  type Project,
  type ProjectDocument,
  type Task,
  type TaskStatus,
} from '../../lib/coordination-types';
import {
  isPastCalendarDate,
} from '../../lib/date-format';
import {
  cn,
} from '../../lib/utils';


export const INVALID_PORTAL_LINK_MESSAGE = 'This portal link is invalid or expired.';
export const REQUEST_LINK_SUCCESS_MESSAGE = 'If that email is registered, a new link has been sent.';
export const LEGACY_PORTAL_TOKEN_KEY = 'portal_session_token';
export const ALL_PROJECTS = 'all';
export const ALL_STATUSES = 'all';
export const OVERDUE_ONLY = 'overdue';

export type PortalSection = 'home' | 'projects' | 'project' | 'tasks' | 'documents' | 'messages' | 'settings';
export type TaskViewMode = 'list' | 'board';
export type TasksByProject = Record<string, Task[]>;

export interface NotificationSummary {
  mentions_requested?: number;
  mentions_resolved?: number;
  message_recipients_notified?: number;
  mention_recipients_notified?: number;
}

export interface PreviewState {
  doc: ProjectDocument;
  url: string;
}

export type ProjectSummary = PortalWorkspace['projects'][number];

export function setPendingKey(
  setter: Dispatch<SetStateAction<Record<string, boolean>>>,
  key: string,
  pending: boolean,
) {
  setter((prev) => {
    if (pending) return { ...prev, [key]: true };
    const next = { ...prev };
    delete next[key];
    return next;
  });
}

export function taskActionKey(projectId: string, taskId: string) {
  return `${projectId}:${taskId}`;
}

export function documentActionKey(action: 'preview' | 'download', projectId: string, docId: string) {
  return `${action}:${projectId}:${docId}`;
}

export function portalPath(token: string, section: string, projectId?: string) {
  if (projectId) return `/portal/${token}/projects/${projectId}`;
  if (section === 'home') return `/portal/${token}`;
  return `/portal/${token}/${section}`;
}

export function routeSection(pathname: string, projectId?: string): PortalSection {
  if (projectId) return 'project';
  if (pathname.includes('/tasks')) return 'tasks';
  if (pathname.includes('/documents')) return 'documents';
  if (pathname.includes('/messages')) return 'messages';
  if (pathname.includes('/settings')) return 'settings';
  if (pathname.endsWith('/projects')) return 'projects';
  return 'home';
}

export function pluralizeRecipients(count: number): string {
  return `${count} recipient${count === 1 ? '' : 's'}`;
}

export function buildDeliverySummaryFromMessageDoc(messageDoc: unknown, mentionsSent: number): NotificationSummary {
  const doc = (messageDoc && typeof messageDoc === 'object') ? (messageDoc as { mentions?: unknown[] }) : null;
  const resolvedMentions = Array.isArray(doc?.mentions) ? doc.mentions.length : 0;
  return {
    mentions_requested: mentionsSent,
    mentions_resolved: resolvedMentions,
    mention_recipients_notified: 0,
    message_recipients_notified: 0,
  };
}

export function messageDeliveryText(summary: NotificationSummary | undefined, mentionsSent: number): string {
  if (!summary) return 'Message sent';
  if (mentionsSent > 0) {
    const mentionDeliveries = summary.mention_recipients_notified ?? 0;
    if (mentionDeliveries > 0) {
      return `Message sent. Mention notifications sent to ${pluralizeRecipients(mentionDeliveries)}.`;
    }
    if ((summary.mentions_resolved ?? 0) === 0) {
      return 'Message sent, but no matching mention recipients were found.';
    }
    return 'Message sent. Mention recipients had notifications off or already received the alert.';
  }
  const messageDeliveries = summary.message_recipients_notified ?? 0;
  if (messageDeliveries > 0) return `Message sent. Notifications sent to ${pluralizeRecipients(messageDeliveries)}.`;
  return 'Message sent';
}

export function activityLabel(action: string) {
  return action
    .split('_').join(' ')
    .replace(/\b\w/g, (char: string) => char.toUpperCase());
}

export function projectProgress(project: ProjectSummary | Project, taskOverride?: readonly Task[]) {
  if (taskOverride) {
    const total = taskOverride.length;
    const completed = taskOverride.filter((task) => task.completed).length;
    return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
  }
  const counts = 'portal_task_counts' in project ? project.portal_task_counts : undefined;
  const total = counts?.total ?? project.task_total ?? 0;
  const completed = counts?.completed ?? project.task_completed ?? 0;
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 };
}

export function statusForTask(task: Task): TaskStatus {
  return task.completed ? 'completed' : (task.status || 'to_do');
}

export function taskMatchesStatusFilter(task: Task, statusFilter: string) {
  if (statusFilter === OVERDUE_ONLY) return !task.completed && isPastCalendarDate(task.due_date);
  if (statusFilter !== ALL_STATUSES) return statusForTask(task) === statusFilter;
  return true;
}

export function filteredTasksForProject(
  project: ProjectSummary,
  allTasks: TasksByProject,
  statusFilter: string,
) {
  return (allTasks[project.id] || []).filter((task) => taskMatchesStatusFilter(task, statusFilter));
}

export function buildFilteredTasks(
  projects: readonly ProjectSummary[],
  allTasks: TasksByProject,
  statusFilter: string,
) {
  return projects.flatMap((project) => filteredTasksForProject(project, allTasks, statusFilter));
}

export function buildFilteredTaskMap(
  projects: readonly ProjectSummary[],
  allTasks: TasksByProject,
  statusFilter: string,
) {
  return Object.fromEntries(
    projects.map((project) => [project.id, filteredTasksForProject(project, allTasks, statusFilter)]),
  );
}

export function phaseBadgeClass(phase: string) {
  switch (phase) {
    case 'planning':
      return 'bg-info-soft text-info-strong border-info/20';
    case 'promotion':
      return 'bg-warn-soft text-warn-strong border-warn/20';
    case 'delivery':
      return 'bg-spoke-soft text-spoke-strong border-spoke/20';
    case 'follow_up':
      return 'bg-ownership-partner-soft text-ownership-partner-strong border-ownership-partner/20';
    default:
      return 'bg-muted text-foreground/80 border-border';
  }
}

export function neutralBadgeClass(extra = '') {
  return cn('bg-muted text-foreground/80 border-border', extra);
}

export function hasPartnerWriteAccess(task: Task) {
  return task.owner === 'partner' || task.owner === 'both';
}

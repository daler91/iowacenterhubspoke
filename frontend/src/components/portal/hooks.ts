/**
 * SWR data hooks for the partner portal.
 *
 * Both fan out across every project the partner can see, so the SWR key
 * carries the joined project ids — a project appearing or disappearing has to
 * produce a new key, otherwise the cache would serve a stale shape.
 *
 * Extracted from PortalDashboard.tsx alongside shared.ts; see that file for
 * the wider split.
 */
import useSWR from 'swr';
import {
  useMemo,
} from 'react';
import {
  portalAPI,
} from '../../lib/coordination-api';

import type { ProjectDocument, Task } from '../../lib/coordination-types';
import type { ProjectSummary } from './shared';

export function usePortalTasks(token: string, projects: readonly ProjectSummary[] | undefined) {
  const projectIds = useMemo(() => (projects ?? []).map(project => project.id), [projects]);
  const key = token && projectIds.length ? ['portal-tasks', token, projectIds.join('|')] : null;
  const { data, error, isLoading, mutate } = useSWR<Record<string, Task[]>>(
    key,
    async () => {
      const res = await portalAPI.bulkProjectTasks(projectIds, token);
      const items = (res.data?.items || {}) as Record<string, Task[]>;
      return Object.fromEntries(projectIds.map(id => [id, items[id] || []]));
    },
    { shouldRetryOnError: false },
  );
  return {
    allTasks: data ?? Object.fromEntries(projectIds.map(id => [id, []])),
    error,
    isLoading,
    mutateTasks: mutate,
  };
}

export function usePortalDocuments(token: string, projects: readonly ProjectSummary[] | undefined) {
  const projectIds = useMemo(() => (projects ?? []).map(project => project.id), [projects]);
  const key = token && projectIds.length ? ['portal-documents', token, projectIds.join('|')] : null;
  const { data, error, isLoading, mutate } = useSWR<Record<string, ProjectDocument[]>>(
    key,
    async () => {
      const entries = await Promise.all(projectIds.map(async (projectId) => {
        const res = await portalAPI.projectDocuments(projectId, token);
        return [projectId, (res.data?.items || []) as ProjectDocument[]] as const;
      }));
      return Object.fromEntries(entries);
    },
    { shouldRetryOnError: false },
  );
  return {
    documents: data ?? Object.fromEntries(projectIds.map(id => [id, []])),
    error,
    isLoading,
    mutateDocuments: mutate,
  };
}

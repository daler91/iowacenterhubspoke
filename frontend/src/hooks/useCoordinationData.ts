import useSWR from 'swr';
import { projectsAPI, partnerOrgsAPI, projectTasksAPI } from '../lib/coordination-api';
import type { Project, PartnerOrg, Task, BoardData, DashboardMetrics } from '../lib/coordination-types';

// SWR config (dedupingInterval, revalidateOnFocus, retries) is now
// inherited from the <SWRConfig> in App.tsx so we don't drift apart from
// useDashboardData and double-fetch on every nav.

function extractItems<T>(res: { data: { items?: T[] } | T[] }): T[] {
  const data = (res.data as { items?: T[] })?.items ?? res.data;
  return Array.isArray(data) ? data : [];
}

// Canonical JSON: sort keys so {a:1,b:2} and {b:2,a:1} share a cache
// entry. JSON.stringify on a raw object is order-sensitive.
function canonical(params: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(params)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = params[k];
        return acc;
      }, {}),
  );
}

export function useProjects(params?: Record<string, unknown>) {
  const key = params ? ['projects', canonical(params)] : 'projects';
  const { data, mutate, error, isLoading } = useSWR<Project[]>(
    key,
    () => projectsAPI.getAll(params).then(extractItems<Project>),
  );
  return { projects: data ?? [], mutateProjects: mutate, error, isLoading };
}

export function useProject(id: string | undefined) {
  const { data, mutate, error, isLoading } = useSWR<Project>(
    id ? `project-${id}` : null,
    () => projectsAPI.getOne(id!).then(res => res.data),
  );
  return { project: data, mutateProject: mutate, error, isLoading };
}

export function useProjectBoard(params?: Record<string, unknown>) {
  const key = params ? ['project-board', canonical(params)] : 'project-board';
  const { data, mutate, error, isLoading } = useSWR<BoardData>(
    key,
    () => projectsAPI.getBoard(params).then(res => res.data),
  );
  return { board: data, mutateBoard: mutate, error, isLoading };
}

export function useCommunityDashboard() {
  const { data, mutate, error, isLoading } = useSWR<DashboardMetrics>(
    'community-dashboard',
    () => projectsAPI.getDashboard().then(res => res.data),
  );
  return { dashboard: data, mutateDashboard: mutate, error, isLoading };
}

export function useProjectTasks(projectId: string | undefined) {
  const { data, mutate, error, isLoading } = useSWR<Task[]>(
    projectId ? `tasks-${projectId}` : null,
    () => projectTasksAPI.getAll(projectId!).then(extractItems<Task>),
  );
  return { tasks: data ?? [], mutateTasks: mutate, error, isLoading };
}

export function usePartnerOrgs(params?: Record<string, unknown>) {
  const key = params ? ['partner-orgs', canonical(params)] : 'partner-orgs';
  const { data, mutate, error, isLoading } = useSWR<PartnerOrg[]>(
    key,
    () => partnerOrgsAPI.getAll(params).then(extractItems<PartnerOrg>),
  );
  return { partnerOrgs: data ?? [], mutatePartnerOrgs: mutate, error, isLoading };
}

export function usePartnerOrg(id: string | undefined) {
  const { data, mutate, error, isLoading } = useSWR<PartnerOrg>(
    id ? `partner-org-${id}` : null,
    () => partnerOrgsAPI.getOne(id!).then(res => res.data),
  );
  return { partnerOrg: data, mutatePartnerOrg: mutate, error, isLoading };
}

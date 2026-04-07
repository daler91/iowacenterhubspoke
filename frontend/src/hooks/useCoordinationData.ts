import useSWR from 'swr';
import { projectsAPI, partnerOrgsAPI, projectTasksAPI } from '../lib/coordination-api';
import type { Project, PartnerOrg, Task, BoardData, DashboardMetrics } from '../lib/coordination-types';

const swrOptions = {
  revalidateOnFocus: false,
  dedupingInterval: 2000,
  errorRetryCount: 3,
};

function extractItems<T>(res: { data: { items?: T[] } | T[] }): T[] {
  const data = (res.data as { items?: T[] })?.items ?? res.data;
  return Array.isArray(data) ? data : [];
}

export function useProjects(params?: Record<string, unknown>) {
  const key = params ? ['projects', JSON.stringify(params)] : 'projects';
  const { data, mutate, error, isLoading } = useSWR<Project[]>(
    key,
    () => projectsAPI.getAll(params).then(extractItems<Project>),
    swrOptions,
  );
  return { projects: data ?? [], mutateProjects: mutate, error, isLoading };
}

export function useProject(id: string | undefined) {
  const { data, mutate, error, isLoading } = useSWR<Project>(
    id ? `project-${id}` : null,
    () => projectsAPI.getOne(id!).then(res => res.data),
    swrOptions,
  );
  return { project: data, mutateProject: mutate, error, isLoading };
}

export function useProjectBoard(params?: Record<string, unknown>) {
  const key = params ? ['project-board', JSON.stringify(params)] : 'project-board';
  const { data, mutate, error, isLoading } = useSWR<BoardData>(
    key,
    () => projectsAPI.getBoard(params).then(res => res.data),
    swrOptions,
  );
  return { board: data, mutateBoard: mutate, error, isLoading };
}

export function useCommunityDashboard() {
  const { data, mutate, error, isLoading } = useSWR<DashboardMetrics>(
    'community-dashboard',
    () => projectsAPI.getDashboard().then(res => res.data),
    swrOptions,
  );
  return { dashboard: data, mutateDashboard: mutate, error, isLoading };
}

export function useProjectTasks(projectId: string | undefined) {
  const { data, mutate, error, isLoading } = useSWR<Task[]>(
    projectId ? `tasks-${projectId}` : null,
    () => projectTasksAPI.getAll(projectId!).then(extractItems<Task>),
    swrOptions,
  );
  return { tasks: data ?? [], mutateTasks: mutate, error, isLoading };
}

export function usePartnerOrgs(params?: Record<string, unknown>) {
  const key = params ? ['partner-orgs', JSON.stringify(params)] : 'partner-orgs';
  const { data, mutate, error, isLoading } = useSWR<PartnerOrg[]>(
    key,
    () => partnerOrgsAPI.getAll(params).then(extractItems<PartnerOrg>),
    swrOptions,
  );
  return { partnerOrgs: data ?? [], mutatePartnerOrgs: mutate, error, isLoading };
}

export function usePartnerOrg(id: string | undefined) {
  const { data, mutate, error, isLoading } = useSWR<PartnerOrg>(
    id ? `partner-org-${id}` : null,
    () => partnerOrgsAPI.getOne(id!).then(res => res.data),
    swrOptions,
  );
  return { partnerOrg: data, mutatePartnerOrg: mutate, error, isLoading };
}

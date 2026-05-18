import useSWR from 'swr';
import { portalAPI } from '../lib/coordination-api';
import type {
  PortalProjectWorkspace,
  PortalWorkspace,
  PartnerContact,
  PartnerOrg,
} from '../lib/coordination-types';

interface PortalSession {
  valid: boolean;
  org: PartnerOrg;
  contact: PartnerContact;
}

export function usePortalSession(token: string) {
  const { data, error, isLoading, mutate } = useSWR<PortalSession>(
    token ? ['portal-session', token] : null,
    () => portalAPI.verify(token).then(res => res.data),
    { shouldRetryOnError: false },
  );
  return { session: data, error, isLoading, mutateSession: mutate };
}

export function usePortalWorkspace(token: string) {
  const { data, error, isLoading, mutate } = useSWR<PortalWorkspace>(
    token ? ['portal-workspace', token] : null,
    () => portalAPI.workspace(token).then(res => res.data),
    { shouldRetryOnError: false },
  );
  return { workspace: data, error, isLoading, mutateWorkspace: mutate };
}

export function usePortalProjectWorkspace(token: string, projectId?: string) {
  const { data, error, isLoading, mutate } = useSWR<PortalProjectWorkspace>(
    token && projectId ? ['portal-project-workspace', token, projectId] : null,
    () => portalAPI.projectWorkspace(projectId!, token).then(res => res.data),
    { shouldRetryOnError: false },
  );
  return {
    projectWorkspace: data,
    error,
    isLoading,
    mutateProjectWorkspace: mutate,
  };
}

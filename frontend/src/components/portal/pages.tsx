/**
 * Page-level components for the partner portal — one per route section.
 *
 * PortalDashboard.tsx now only resolves the session, picks a section from the
 * URL and renders one of these.
 */
import NotificationPreferences from '../NotificationPreferences';
import PortalTaskBoard from './PortalTaskBoard';
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  useNavigate,
} from 'react-router-dom';
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  FileText,
  GraduationCap,
  MessageSquare,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  toast,
} from 'sonner';
import {
  Badge,
} from '../ui/badge';
import {
  Button,
} from '../ui/button';
import {
  Card,
} from '../ui/card';
import {
  Input,
} from '../ui/input';
import {
  PageShell,
} from '../ui/page-shell';
import {
  SearchableSelect,
} from '../ui/searchable-select';
import {
  portalAPI,
} from '../../lib/coordination-api';
import {
  PHASE_LABELS,
  type PortalWorkspace,
  type Project,
  type Task,
  type TaskStatus,
} from '../../lib/coordination-types';
import {
  formatCalendarDate,
  isPastCalendarDate,
} from '../../lib/date-format';
import {
  describeApiError,
} from '../../lib/error-messages';
import {
  usePortalProjectWorkspace,
} from '../../hooks/usePortalData';
import {
  runPortalAsync,
} from './async';
import {
  ALL_PROJECTS,
  ALL_STATUSES,
  buildFilteredTaskMap,
  buildFilteredTasks,
  hasPartnerWriteAccess,
  neutralBadgeClass,
  phaseBadgeClass,
  portalPath,
  projectProgress,
  setPendingKey,
  taskActionKey,
  type TaskViewMode,
} from './shared';
import {
  usePortalDocuments,
  usePortalTasks,
} from './hooks';
import {
  ActivityList,
  DocumentList,
  EmptyState,
  MessageThread,
  MetricCard,
  ProgressBar,
  ProjectCard,
  TaskControls,
  TaskDetailLauncher,
  TaskList,
} from './components';


export function HomePage({
  workspace,
  token,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
}>) {
  const navigate = useNavigate();
  const projectsById = useMemo(() => Object.fromEntries(workspace.projects.map(project => [project.id, project])), [workspace.projects]);
  return (
    <PageShell
      testId="portal-home-page"
      title="Partner Home"
      subtitle="Your project workspace, active classes, shared resources, and conversation in one place."
      actions={
        <Button
          type="button"
          className="bg-hub hover:bg-hub-strong text-white"
          onClick={() => navigate(portalPath(token, 'projects'))}
        >
          <Briefcase className="h-4 w-4 mr-2" aria-hidden="true" />
          Open Projects
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Active Projects"
          value={workspace.summary.active_projects}
          icon={<Briefcase className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Open Tasks"
          value={workspace.summary.open_tasks}
          tone={workspace.summary.overdue_tasks > 0 ? 'warn' : 'spoke'}
          icon={<CheckSquare className="h-5 w-5" aria-hidden="true" />}
          detail={workspace.summary.overdue_tasks > 0 ? `${workspace.summary.overdue_tasks} overdue` : 'On track'}
        />
        <MetricCard
          label="Upcoming Classes"
          value={workspace.summary.upcoming_classes}
          icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Classes Hosted"
          value={workspace.summary.classes_hosted}
          tone="spoke"
          icon={<GraduationCap className="h-5 w-5" aria-hidden="true" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-3" aria-labelledby="portal-home-projects">
          <div className="flex items-center justify-between gap-3">
            <h2 id="portal-home-projects" className="text-lg font-semibold text-foreground">Active projects</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate(portalPath(token, 'projects'))}>
              View all
            </Button>
          </div>
          {workspace.projects.length === 0 ? (
            <EmptyState
              title="No active projects"
              description="When HubSpoke shares projects with your organization, they will appear here."
              icon={<Briefcase className="w-10 h-10" aria-hidden="true" />}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {workspace.projects.slice(0, 6).map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => navigate(portalPath(token, 'projects', project.id))}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section aria-labelledby="portal-home-attention">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="portal-home-attention" className="text-lg font-semibold text-foreground">Needs attention</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigate(portalPath(token, 'tasks'))}>
                Tasks
              </Button>
            </div>
            <TaskList
              tasks={workspace.needs_attention}
              projectsById={projectsById}
              pendingTaskIds={{}}
              onToggleTask={() => undefined}
              onOpenTask={(projectId, taskId) => navigate(`${portalPath(token, 'tasks')}?project=${projectId}&task=${taskId}`)}
            />
          </section>
        </aside>
      </div>

      <section className="space-y-3" aria-labelledby="portal-home-activity">
        <h2 id="portal-home-activity" className="text-lg font-semibold text-foreground">Recent portal activity</h2>
        <ActivityList events={workspace.recent_activity} />
      </section>
    </PageShell>
  );
}

export function ProjectsPage({
  workspace,
  token,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
}>) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return workspace.projects;
    return workspace.projects.filter(project => [
      project.title,
      project.community,
      project.venue_name,
      PHASE_LABELS[project.phase],
    ].some(value => (value || '').toLowerCase().includes(q)));
  }, [workspace.projects, query]);

  return (
    <PageShell
      testId="portal-projects-page"
      title="Projects"
      subtitle="Open a project hub to review tasks, documents, messages, and shared activity."
      actions={
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label htmlFor="portal-project-search" className="sr-only">Search projects</label>
          <Input
            id="portal-project-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects..."
            className="pl-8"
          />
        </div>
      }
    >
      {visibleProjects.length === 0 ? (
        <EmptyState
          title="No projects match"
          description="Try a different project, community, venue, or phase search."
          icon={<Briefcase className="w-10 h-10" aria-hidden="true" />}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="portal-project-grid">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => navigate(portalPath(token, 'projects', project.id))}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

export function TasksPage({
  workspace,
  token,
  refreshWorkspace,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
  refreshWorkspace: () => Promise<void> | void;
}>) {
  const { allTasks, error, isLoading, mutateTasks } = usePortalTasks(token, workspace.projects);
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [statusFilter, setStatusFilter] = useState(ALL_STATUSES);
  const [viewMode, setViewMode] = useState<TaskViewMode>('list');
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);

  const projectsById = useMemo(() => Object.fromEntries(workspace.projects.map(project => [project.id, project])), [workspace.projects]);
  const selectedProjects = useMemo(() => (
    projectFilter === ALL_PROJECTS
      ? workspace.projects
      : workspace.projects.filter(project => project.id === projectFilter)
  ), [projectFilter, workspace.projects]);
  const filteredTasks = useMemo(
    () => buildFilteredTasks(selectedProjects, allTasks, statusFilter),
    [allTasks, selectedProjects, statusFilter],
  );
  const filteredTaskMap = useMemo(
    () => buildFilteredTaskMap(selectedProjects, allTasks, statusFilter),
    [allTasks, selectedProjects, statusFilter],
  );

  const refreshTasks = async () => {
    await mutateTasks();
    await refreshWorkspace();
  };

  const handleToggleTask = async (projectId: string, task: Task) => {
    const key = taskActionKey(projectId, task.id);
    if (pendingTaskIds[key] || !hasPartnerWriteAccess(task)) return;
    setPendingKey(setPendingTaskIds, key, true);
    try {
      const completed = !task.completed;
      await portalAPI.updateTask(projectId, task.id, token, {
        completed,
        status: completed ? 'completed' : 'to_do',
      });
      await refreshTasks();
      toast.success('Task updated');
    } catch (err) {
      toast.error(describeApiError(err, 'Failed to update task'));
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  const handleMoveTask = async (projectId: string, task: Task, status: TaskStatus) => {
    const key = taskActionKey(projectId, task.id);
    if (pendingTaskIds[key]) return { ok: false, message: 'That task update is still saving.' };
    setPendingKey(setPendingTaskIds, key, true);
    try {
      await portalAPI.updateTask(projectId, task.id, token, {
        status,
        completed: status === 'completed',
      });
      await refreshTasks();
      return { ok: true };
    } catch (err) {
      const message = describeApiError(err, 'You do not have permission to move that task to this status.');
      toast.error(message);
      return { ok: false, message };
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  const projectOptions = [
    { value: ALL_PROJECTS, label: 'All projects' },
    ...workspace.projects.map(project => ({ value: project.id, label: project.title })),
  ];

  if (workspace.projects.length === 0) {
    return (
      <PageShell testId="portal-tasks-page" title="Tasks" subtitle="Tasks needing partner action across your shared projects.">
        <EmptyState
          title="No active projects"
          description="Tasks will appear when a project is shared with your organization."
          icon={<CheckSquare className="w-10 h-10" aria-hidden="true" />}
        />
      </PageShell>
    );
  }

  let taskContent: ReactNode;
  if (error) {
    taskContent = (
      <Card className="p-5 border-danger/30 bg-danger-soft" role="alert">
        <p className="text-sm font-semibold text-foreground">Tasks could not be loaded.</p>
        <p className="mt-1 text-sm text-muted-foreground">{describeApiError(error, "We couldn't load your tasks.")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            runPortalAsync(mutateTasks(), 'retry portal tasks');
          }}
        >
          Retry tasks
        </Button>
      </Card>
    );
  } else if (viewMode === 'board') {
    taskContent = filteredTasks.length === 0 ? (
      <EmptyState title="No tasks assigned to you" description="Try changing the project or status filters." />
    ) : (
      <PortalTaskBoard
        projects={selectedProjects}
        allTasks={filteredTaskMap}
        onOpenTask={(projectId, taskId) => setSelectedTask({ projectId, taskId })}
        onMoveTask={handleMoveTask}
      />
    );
  } else {
    taskContent = (
      <TaskList
        tasks={filteredTasks}
        projectsById={projectsById}
        pendingTaskIds={pendingTaskIds}
        onToggleTask={handleToggleTask}
        onOpenTask={(projectId, taskId) => setSelectedTask({ projectId, taskId })}
      />
    );
  }

  return (
    <PageShell
      testId="portal-tasks-page"
      title="Tasks"
      subtitle="Your task inbox, with filters and a board view for project work."
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            runPortalAsync(refreshTasks(), 'refresh portal tasks');
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Refresh
        </Button>
      }
      status={isLoading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
    >
      <TaskControls
        projectOptions={projectOptions}
        projectFilter={projectFilter}
        statusFilter={statusFilter}
        viewMode={viewMode}
        onProjectFilter={setProjectFilter}
        onStatusFilter={setStatusFilter}
        onViewMode={setViewMode}
      />

      {taskContent}

      <TaskDetailLauncher
        selectedTask={selectedTask}
        token={token}
        onClose={() => setSelectedTask(null)}
        onRefresh={refreshTasks}
      />
    </PageShell>
  );
}

export function DocumentsPage({
  workspace,
  token,
  refreshWorkspace,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
  refreshWorkspace: () => Promise<void> | void;
}>) {
  const { documents, error, isLoading, mutateDocuments } = usePortalDocuments(token, workspace.projects);
  const refreshDocuments = async () => {
    await mutateDocuments();
    await refreshWorkspace();
  };

  return (
    <PageShell
      testId="portal-documents-page"
      title="Documents"
      subtitle="Shared organization files and project documents, grouped by project."
      status={isLoading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            runPortalAsync(refreshDocuments(), 'refresh portal documents');
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          Refresh
        </Button>
      }
    >
      {error ? (
        <Card className="p-5 border-danger/30 bg-danger-soft" role="alert">
          <p className="text-sm font-semibold text-foreground">Documents could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{describeApiError(error, "We couldn't load shared documents.")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              runPortalAsync(mutateDocuments(), 'retry portal documents');
            }}
          >
            Retry documents
          </Button>
        </Card>
      ) : (
        <DocumentList
          token={token}
          projects={workspace.projects}
          documentsByProject={documents}
          orgDocuments={workspace.org_documents}
          onUploaded={refreshDocuments}
        />
      )}
    </PageShell>
  );
}

export function MessagesPage({
  workspace,
  token,
}: Readonly<{
  workspace: PortalWorkspace;
  token: string;
}>) {
  const [activeProjectId, setActiveProjectId] = useState(() => workspace.projects[0]?.id || '');
  useEffect(() => {
    if (!activeProjectId && workspace.projects[0]?.id) setActiveProjectId(workspace.projects[0].id);
  }, [activeProjectId, workspace.projects]);

  const { projectWorkspace, error, isLoading, mutateProjectWorkspace } = usePortalProjectWorkspace(token, activeProjectId);
  const activeProject = workspace.projects.find(project => project.id === activeProjectId);
  const projectOptions = workspace.projects.map(project => ({ value: project.id, label: project.title }));

  let messageContent: ReactNode;
  if (workspace.projects.length === 0) {
    messageContent = (
      <EmptyState
        title="No project threads"
        description="Messages become available when a project is shared with your organization."
        icon={<MessageSquare className="w-10 h-10" aria-hidden="true" />}
      />
    );
  } else if (error || !activeProject) {
    messageContent = (
      <Card className="p-5 border-danger/30 bg-danger-soft" role="alert">
        <p className="text-sm font-semibold text-foreground">Messages could not be loaded.</p>
        <p className="mt-1 text-sm text-muted-foreground">{describeApiError(error, "We couldn't load messages for this project.")}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            runPortalAsync(mutateProjectWorkspace(), 'retry portal messages');
          }}
        >
          Retry messages
        </Button>
      </Card>
    );
  } else {
    messageContent = (
      <MessageThread
        token={token}
        project={activeProject}
        messages={projectWorkspace?.messages || []}
        members={projectWorkspace?.members || []}
        onRefresh={async () => { await mutateProjectWorkspace(); }}
      />
    );
  }

  return (
    <PageShell
      testId="portal-messages-page"
      title="Messages"
      subtitle="Project-specific partner conversations with delivery confirmation."
      status={isLoading ? { kind: 'loading', variant: 'rows' } : { kind: 'ready' }}
      actions={workspace.projects.length > 0 ? (
        <div className="w-full sm:w-72">
          <SearchableSelect
            id="portal-message-project"
            options={projectOptions}
            value={activeProjectId}
            onValueChange={(value) => setActiveProjectId(value || workspace.projects[0]?.id || '')}
            placeholder="Choose a project"
            searchPlaceholder="Search projects..."
          />
        </div>
      ) : undefined}
    >
      {messageContent}
    </PageShell>
  );
}

export function SettingsPage({ token }: Readonly<{ token: string }>) {
  return (
    <PageShell
      testId="portal-settings-page"
      title="Settings"
      subtitle="Manage portal notification preferences for your partner contact."
    >
      <Card className="p-4">
        <NotificationPreferences mode="portal" portalToken={token} />
      </Card>
    </PageShell>
  );
}

export function ProjectHubPage({
  token,
  projectId,
  refreshWorkspace,
}: Readonly<{
  token: string;
  projectId: string;
  refreshWorkspace: () => Promise<void> | void;
}>) {
  const { projectWorkspace, error, isLoading, mutateProjectWorkspace } = usePortalProjectWorkspace(token, projectId);
  const [pendingTaskIds, setPendingTaskIds] = useState<Record<string, boolean>>({});
  const [selectedTask, setSelectedTask] = useState<{ projectId: string; taskId: string } | null>(null);

  const refreshProject = async () => {
    await mutateProjectWorkspace();
    await refreshWorkspace();
  };

  const handleToggleTask = async (projectTaskId: string, task: Task) => {
    const key = taskActionKey(projectTaskId, task.id);
    if (pendingTaskIds[key] || !hasPartnerWriteAccess(task)) return;
    setPendingKey(setPendingTaskIds, key, true);
    try {
      const completed = !task.completed;
      await portalAPI.updateTask(projectTaskId, task.id, token, {
        completed,
        status: completed ? 'completed' : 'to_do',
      });
      await refreshProject();
      toast.success('Task updated');
    } catch (err) {
      toast.error(describeApiError(err, 'Failed to update task'));
    } finally {
      setPendingKey(setPendingTaskIds, key, false);
    }
  };

  if (isLoading) {
    return (
      <PageShell
        testId="portal-project-hub-page"
        title="Project Hub"
        subtitle="Loading project workspace..."
        status={{ kind: 'loading', variant: 'cards' }}
      />
    );
  }

  if (error || !projectWorkspace) {
    return (
      <PageShell
        testId="portal-project-hub-page"
        title="Project Hub"
        subtitle="This project could not be loaded."
        status={{
          kind: 'error',
          error: { message: describeApiError(error, 'Project workspace could not be loaded.') },
          onRetry: () => {
            runPortalAsync(mutateProjectWorkspace(), 'retry portal project workspace');
          },
        }}
      />
    );
  }

  const { project, tasks, documents, messages, members, recent_activity: recentActivity } = projectWorkspace;
  const progress = projectProgress(project, tasks);
  const overdue = tasks.filter(task => !task.completed && isPastCalendarDate(task.due_date)).length;
  const projectsById = { [project.id]: project };

  return (
    <PageShell
      testId="portal-project-hub-page"
      breadcrumbs={[{ label: 'Portal' }, { label: 'Projects', path: portalPath(token, 'projects') }, { label: project.title }]}
      title={project.title}
      subtitle={`${formatCalendarDate(project.event_date)} - ${project.venue_name} - ${project.community}`}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={phaseBadgeClass(project.phase)}>{PHASE_LABELS[project.phase]}</Badge>
          {overdue > 0 && <Badge className="bg-warn-soft text-warn-strong border-0">{overdue} overdue</Badge>}
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Progress"
          value={progress.percent}
          tone="spoke"
          icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
          detail={`${progress.completed}/${progress.total} tasks complete`}
        />
        <MetricCard
          label="Open Tasks"
          value={tasks.filter(task => !task.completed).length}
          tone={overdue > 0 ? 'warn' : 'hub'}
          icon={<CheckSquare className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Documents"
          value={documents.length}
          icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        />
        <MetricCard
          label="Messages"
          value={messages.length}
          icon={<MessageSquare className="h-5 w-5" aria-hidden="true" />}
        />
      </div>

      <Card className="p-4">
        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
          <span>Project progress</span>
          <span>{progress.percent}%</span>
        </div>
        <ProgressBar percent={progress.percent} label={`${project.title} project progress`} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="space-y-3" aria-labelledby="portal-project-tasks">
          <div className="flex items-center justify-between gap-3">
            <h2 id="portal-project-tasks" className="text-lg font-semibold text-foreground">Tasks</h2>
            <Badge className={neutralBadgeClass('text-[10px]')}>{tasks.length} total</Badge>
          </div>
          <TaskList
            tasks={tasks}
            projectsById={projectsById}
            pendingTaskIds={pendingTaskIds}
            onToggleTask={handleToggleTask}
            onOpenTask={(nextProjectId, taskId) => setSelectedTask({ projectId: nextProjectId, taskId })}
          />
        </section>
        <section className="space-y-3" aria-labelledby="portal-project-activity">
          <h2 id="portal-project-activity" className="text-lg font-semibold text-foreground">Activity</h2>
          <ActivityList events={recentActivity} emptyTitle="No project activity yet" />
        </section>
      </div>

      <section className="space-y-3" aria-labelledby="portal-project-documents">
        <h2 id="portal-project-documents" className="text-lg font-semibold text-foreground">Documents</h2>
        <DocumentList
          token={token}
          projects={[project]}
          documentsByProject={{ [project.id]: documents }}
          onUploaded={refreshProject}
        />
      </section>

      <section className="space-y-3" aria-labelledby="portal-project-messages">
        <h2 id="portal-project-messages" className="text-lg font-semibold text-foreground">Messages</h2>
        <MessageThread
          token={token}
          project={project}
          messages={messages}
          members={members}
          onRefresh={refreshProject}
        />
      </section>

      <TaskDetailLauncher
        selectedTask={selectedTask}
        token={token}
        onClose={() => setSelectedTask(null)}
        onRefresh={refreshProject}
      />
    </PageShell>
  );
}

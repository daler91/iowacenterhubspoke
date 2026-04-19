import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  CalendarDays, CheckSquare, GraduationCap, AlertTriangle,
  FileText, Send, Download,
} from 'lucide-react';
import { portalAPI } from '../../lib/coordination-api';
import {
  PHASE_LABELS, PHASE_COLORS, OWNER_COLORS, OWNER_LABELS,
} from '../../lib/coordination-types';
import type { PartnerOrg, PartnerContact, Project, Task, ProjectDocument, Message } from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import { toast } from 'sonner';
import PortalLayout from './PortalLayout';
import NotificationPreferences from '../NotificationPreferences';

const PORTAL_TOKEN_KEY = 'portal_session_token';

export default function PortalDashboard() {
  const { token: urlToken } = useParams<{ token: string }>();
  // Prefer URL token, fall back to sessionStorage for in-session persistence
  const token = urlToken || sessionStorage.getItem(PORTAL_TOKEN_KEY) || '';
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [org, setOrg] = useState<PartnerOrg | null>(null);
  const [contact, setContact] = useState<PartnerContact | null>(null);
  const [dashboardData, setDashboardData] = useState<{
    upcoming_classes: number;
    open_tasks: number;
    overdue_tasks: number;
    classes_hosted: number;
    projects: Project[];
  } | null>(null);

  // Tab-specific state
  const [allTasks, setAllTasks] = useState<Record<string, Task[]>>({});
  const [documents, setDocuments] = useState<Record<string, ProjectDocument[]>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [msgBody, setMsgBody] = useState('');
  const [activeProject, setActiveProject] = useState('');

  useEffect(() => {
    if (!token) { setError('No portal token provided'); setLoading(false); return; }
    (async () => {
      try {
        const verifyRes = await portalAPI.verify(token);
        setOrg(verifyRes.data.org);
        setContact(verifyRes.data.contact);
        // Persist token in session so portal survives tab navigation
        sessionStorage.setItem(PORTAL_TOKEN_KEY, token);

        const dashRes = await portalAPI.dashboard(token);
        setDashboardData(dashRes.data);
      } catch {
        sessionStorage.removeItem(PORTAL_TOKEN_KEY);
        setError('Invalid or expired portal link');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const loadTasks = async () => {
    if (!token || !dashboardData?.projects) return;
    // Single bulk request instead of N parallel /tasks calls. Backend
    // groups tasks by project_id and authz-clamps to projects this token
    // actually owns.
    const projectIds = dashboardData.projects.map(p => p.id);
    try {
      const res = await portalAPI.bulkProjectTasks(projectIds, token);
      const items = (res.data?.items || {}) as Record<string, unknown[]>;
      // Make sure every project has an entry, even if it has no tasks.
      const filled: Record<string, unknown[]> = {};
      projectIds.forEach(id => { filled[id] = items[id] || []; });
      setAllTasks(filled);
    } catch {
      const empty: Record<string, unknown[]> = {};
      projectIds.forEach(id => { empty[id] = []; });
      setAllTasks(empty);
    }
  };

  const loadDocuments = async () => {
    if (!token || !dashboardData?.projects) return;
    const results = await Promise.all(
      dashboardData.projects.map(async (p) => {
        try {
          const res = await portalAPI.projectDocuments(p.id, token);
          return [p.id, res.data.items || []] as const;
        } catch {
          return [p.id, []] as const;
        }
      })
    );
    setDocuments(Object.fromEntries(results));
  };

  const loadMessages = async (projectId: string) => {
    if (!token) return;
    try {
      const res = await portalAPI.projectMessages(projectId, token);
      setMessages(res.data.items || []);
      setActiveProject(projectId);
    } catch {
      toast.error('Failed to load messages');
    }
  };

  useEffect(() => {
    if (activeTab === 'tasks') loadTasks();
    if (activeTab === 'documents') loadDocuments();
    if (activeTab === 'messages' && dashboardData?.projects?.[0]) {
      loadMessages(dashboardData.projects[0].id);
    }
  }, [activeTab, dashboardData]);

  const handleToggleTask = async (projectId: string, taskId: string) => {
    if (!token) return;
    try {
      await portalAPI.completeTask(projectId, taskId, token);
      await loadTasks();
      toast.success('Task updated', {
        action: {
          label: 'Undo',
          onClick: async () => {
            try {
              await portalAPI.completeTask(projectId, taskId, token);
              await loadTasks();
              toast.success('Task reverted');
            } catch {
              toast.error('Failed to undo');
            }
          },
        },
        duration: 5000,
      });
    } catch {
      toast.error('Failed to update task');
    }
  };

  const handleSendMessage = async () => {
    if (!token || !activeProject || !msgBody.trim()) return;
    try {
      const project = dashboardData?.projects.find(p => p.id === activeProject);
      await portalAPI.sendMessage(activeProject, token, {
        channel: project?.title || 'general',
        body: msgBody.trim(),
      });
      setMsgBody('');
      loadMessages(activeProject);
    } catch {
      toast.error('Failed to send message');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <output aria-label="Loading portal">
          <span className="block w-10 h-10 border-4 border-hub border-t-transparent rounded-full animate-spin" />
        </output>
      </div>
    );
  }

  if (error || !org || !contact) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="p-6 sm:p-8 w-full max-w-sm text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-warn mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold mb-2">Access Denied</h2>
          <p className="text-sm text-slate-500">{error || 'Invalid portal link'}</p>
        </Card>
      </div>
    );
  }

  return (
    <PortalLayout org={org} contact={contact} activeTab={activeTab} onTabChange={setActiveTab} token={token}>
      {/* Overview Tab */}
      {activeTab === 'overview' && dashboardData && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
            <Card className="p-4 flex items-center gap-3">
              <CalendarDays className="w-8 h-8 text-hub shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-2xl font-bold">{dashboardData.upcoming_classes}</p>
                <p className="text-xs text-slate-500">Upcoming Classes</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3">
              <CheckSquare
                className={cn('w-8 h-8 shrink-0', dashboardData.overdue_tasks > 0 ? 'text-warn' : 'text-spoke')}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-2xl font-bold">
                  {dashboardData.open_tasks}
                  {dashboardData.overdue_tasks > 0 && (
                    <span className="text-xs text-warn ml-1">({dashboardData.overdue_tasks} overdue)</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">Open Tasks</p>
              </div>
            </Card>
            <Card className="p-4 flex items-center gap-3 sm:col-span-2 lg:col-span-1">
              <GraduationCap className="w-8 h-8 text-spoke shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-2xl font-bold">{dashboardData.classes_hosted}</p>
                <p className="text-xs text-slate-500">Classes Hosted</p>
              </div>
            </Card>
          </div>

          <h2 className="text-lg font-semibold mb-3">Upcoming Classes</h2>
          <div className="space-y-3">
            {dashboardData.projects.map(project => (
              <Card key={project.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1 flex-wrap">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 min-w-0">
                    {project.title}
                  </h3>
                  <Badge className={cn('text-[10px] shrink-0', PHASE_COLORS[project.phase], 'text-white')}>
                    {PHASE_LABELS[project.phase]}
                  </Badge>
                </div>
                <p className="text-sm text-slate-500">
                  {new Date(project.event_date).toLocaleDateString()} &middot; {project.venue_name}
                </p>
              </Card>
            ))}
            {dashboardData.projects.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No upcoming classes</p>
            )}
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && dashboardData && (
        <div className="space-y-6">
          {dashboardData.projects.map(project => {
            const tasks = allTasks[project.id] || [];
            if (tasks.length === 0) return null;
            return (
              <div key={project.id}>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">{project.title}</h3>
                <div className="space-y-2">
                  {tasks.map(task => {
                    const isOverdue = !task.completed && task.due_date < new Date().toISOString();
                    return (
                      <Card key={task.id} className={cn('p-3', task.completed && 'opacity-50')}>
                        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleToggleTask(project.id, task.id)}
                            aria-label={`Mark "${task.title}" ${task.completed ? 'incomplete' : 'complete'}`}
                            aria-pressed={task.completed}
                            className={cn(
                              'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
                              task.completed
                                ? 'bg-spoke border-spoke text-white'
                                : 'border-slate-300 hover:border-hub',
                            )}
                          >
                            {task.completed && <span className="text-xs" aria-hidden="true">&#10003;</span>}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className={cn('text-sm', task.completed && 'line-through text-muted-foreground')}>
                              {task.title}
                            </p>
                          </div>
                          <span className={cn('text-xs shrink-0', isOverdue ? 'text-danger font-semibold' : 'text-muted-foreground')}>
                            {new Date(task.due_date).toLocaleDateString()}
                          </span>
                          <Badge className={cn('text-[10px] px-1.5 shrink-0', OWNER_COLORS[task.owner])}>
                            {OWNER_LABELS[task.owner]}
                          </Badge>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {Object.values(allTasks).flat().length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No tasks assigned to you</p>
          )}
        </div>
      )}

      {/* Documents Tab */}
      {activeTab === 'documents' && dashboardData && (
        <div className="space-y-6">
          {dashboardData.projects.map(project => {
            const docs = documents[project.id] || [];
            if (docs.length === 0) return null;
            return (
              <div key={project.id}>
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">{project.title}</h3>
                <div className="space-y-2">
                  {docs.map(doc => (
                    <Card key={doc.id} className="p-3 flex items-center gap-3">
                      <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{doc.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {doc.file_type.toUpperCase()} &middot; {new Date(doc.uploaded_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">{doc.file_type.toUpperCase()}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            const res = await portalAPI.downloadDocument(project.id, doc.id, token);
                            const blob = new Blob([res.data]);
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = doc.filename;
                            a.click();
                            URL.revokeObjectURL(url);
                          } catch {
                            // silent fail — toast not available in portal
                          }
                        }}
                        className="shrink-0"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
          {Object.values(documents).flat().length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No shared documents</p>
          )}
        </div>
      )}

      {/* Messages Tab */}
      {activeTab === 'messages' && dashboardData && (
        <div>
          {/* Channel switcher */}
          <div className="flex gap-2 mb-4 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Message channels">
            {dashboardData.projects.map(project => (
              <button
                key={project.id}
                type="button"
                role="tab"
                aria-selected={activeProject === project.id}
                onClick={() => loadMessages(project.id)}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-lg whitespace-nowrap transition-colors shrink-0',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
                  activeProject === project.id
                    ? 'bg-hub-soft text-hub-strong'
                    : 'bg-gray-100 text-slate-500 hover:bg-gray-200',
                )}
              >
                {project.title}
              </button>
            ))}
          </div>

          {/* Messages */}
          <Card className="p-4 mb-3 max-h-96 overflow-y-auto">
            {messages.length > 0 ? (
              <div className="space-y-3">
                {messages.map(msg => (
                  <div key={msg.id} className="flex gap-3">
                    <div
                      className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                        msg.sender_type === 'partner'
                          ? 'bg-ownership-partner-soft text-ownership-partner'
                          : 'bg-ownership-internal-soft text-ownership-internal',
                      )}
                      aria-hidden="true"
                    >
                      {msg.sender_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-sm font-medium">{msg.sender_name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(msg.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 dark:text-muted-foreground mt-0.5 break-words">{msg.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet</p>
            )}
          </Card>

          {/* Input */}
          <div className="flex gap-2">
            <label htmlFor="portal-message-input" className="sr-only">Message</label>
            <Input
              id="portal-message-input"
              value={msgBody}
              onChange={e => setMsgBody(e.target.value)}
              placeholder="Type a message..."
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
            />
            <Button
              type="button"
              onClick={handleSendMessage}
              aria-label="Send message"
              className="bg-hub hover:bg-hub/90 text-white px-4 shrink-0"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {/* Settings Tab — notification preferences. Partners don't get
          password/calendar settings (magic-link auth), so this tab is
          dedicated to communication controls. */}
      {activeTab === 'settings' && (
        <div className="max-w-2xl">
          <Card className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold mb-1">Notifications</h2>
            <p className="text-sm text-slate-500 mb-4">
              Choose which emails and in-portal alerts you receive.
            </p>
            <NotificationPreferences mode="portal" portalToken={token} />
          </Card>
        </div>
      )}
    </PortalLayout>
  );
}

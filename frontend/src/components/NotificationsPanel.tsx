import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, CalendarDays, UserX, X, Settings as SettingsIcon } from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { notificationsAPI } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * The panel merges two notification sources:
 *
 * - **Live system alerts** from ``/notifications`` — ephemeral, recomputed
 *   on every poll (upcoming classes, town-to-town, idle employees). These
 *   were already here; dismissing them is client-side only.
 * - **Persistent inbox items** from ``/notifications/inbox`` — stored rows
 *   written by the dispatcher (task reminders, planned events). These
 *   support server-side mark-as-read and dismiss.
 *
 * The bell shows a combined unread count. Each item knows which source it
 * came from so dismissal hits the right code path.
 */

interface LiveNotification {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly severity: 'info' | 'warning';
  readonly timestamp: string;
  readonly entity_id?: string;
  readonly source: 'live';
}

interface InboxNotification {
  readonly id: string;
  readonly type_key: string;
  readonly title: string;
  readonly body: string;
  readonly severity: 'info' | 'warning';
  readonly link: string | null;
  readonly read_at: string | null;
  readonly created_at: string;
  readonly source: 'inbox';
}

type AnyNotification = LiveNotification | InboxNotification;

function getLiveLink(type: string): string | null {
  if (type === 'upcoming_class' || type === 'town_to_town') return '/calendar';
  if (type === 'idle_employee') return '/employees';
  return null;
}

/**
 * Coerce an ``unknown`` JSON field to a safe string.
 *
 * ``String(x ?? '')`` would call Object's default stringifier on
 * non-string values (``[object Object]``), which is useless in a UI.
 * We explicitly accept only string | number so a malformed payload
 * degrades to an empty string instead of leaking type info.
 */
function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

const SEVERITY_CONFIG = {
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  info: { icon: CalendarDays, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
};

export default function NotificationsPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [liveItems, setLiveItems] = useState<LiveNotification[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxNotification[]>([]);
  const [dismissedLive, setDismissedLive] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let currentController: AbortController | null = null;

    const fetchOnce = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      currentController?.abort();
      const controller = new AbortController();
      currentController = controller;
      try {
        const [liveRes, inboxRes] = await Promise.allSettled([
          notificationsAPI.getAll({ signal: controller.signal }),
          notificationsAPI.getInbox({ signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;

        if (liveRes.status === 'fulfilled') {
          const raw = Array.isArray(liveRes.value.data) ? liveRes.value.data : [];
          setLiveItems(raw.map((n: Record<string, unknown>) => ({
            id: asString(n.id),
            type: asString(n.type),
            title: asString(n.title),
            description: asString(n.description),
            severity: (n.severity === 'warning' ? 'warning' : 'info'),
            timestamp: asString(n.timestamp),
            entity_id: typeof n.entity_id === 'string' ? n.entity_id : undefined,
            source: 'live',
          })));
        }
        if (inboxRes.status === 'fulfilled') {
          const data = inboxRes.value.data as { items?: Record<string, unknown>[] };
          const items = Array.isArray(data?.items) ? data.items : [];
          setInboxItems(items.map((n) => ({
            id: asString(n.id),
            type_key: asString(n.type_key),
            title: asString(n.title),
            body: asString(n.body),
            severity: (n.severity === 'warning' ? 'warning' : 'info'),
            link: typeof n.link === 'string' ? n.link : null,
            read_at: typeof n.read_at === 'string' ? n.read_at : null,
            created_at: asString(n.created_at),
            source: 'inbox',
          })));
        }
      } catch (err) {
        if (controller.signal.aborted || (err as { code?: string })?.code === 'ERR_CANCELED') return;
        // Network glitch — keep existing state rather than blanking the UI.
      }
    };

    fetchOnce();
    const interval = setInterval(fetchOnce, 30000);

    const onVisibility = () => {
      if (!document.hidden) fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      currentController?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { activeNotifications, warningCount } = useMemo(() => {
    const live: AnyNotification[] = liveItems.filter(n => !dismissedLive.has(n.id));
    const inbox: AnyNotification[] = inboxItems;
    const merged = [...inbox, ...live];
    return {
      activeNotifications: merged,
      warningCount: merged.filter(n => n.severity === 'warning').length,
    };
  }, [liveItems, inboxItems, dismissedLive]);

  let bellLabel = 'Notifications';
  if (activeNotifications.length > 0) {
    bellLabel = `Notifications, ${activeNotifications.length} active`;
    if (warningCount > 0) {
      bellLabel += `, ${warningCount} alerts`;
    }
  }

  const handleDismiss = async (n: AnyNotification) => {
    if (n.source === 'live') {
      setDismissedLive(prev => new Set([...prev, n.id]));
      return;
    }
    // Optimistic: drop from state first, call server in background.
    setInboxItems(prev => prev.filter(i => i.id !== n.id));
    try {
      await notificationsAPI.dismiss(n.id);
    } catch {
      // If dismissal failed the item reappears on the next poll (30s).
    }
  };

  const handleDismissAll = async () => {
    // Mirror per-row dismissal: hide live alerts client-side and actually
    // remove each inbox row server-side. "Dismiss all" should empty the
    // panel — just marking read still left items visible, which defeats
    // the point of the button.
    setDismissedLive(new Set(liveItems.map(n => n.id)));
    const toDismiss = inboxItems;
    // Optimistic clear so the panel empties immediately.
    setInboxItems([]);
    try {
      await Promise.all(toDismiss.map(n => notificationsAPI.dismiss(n.id)));
    } catch {
      // Any failed dismissals will reappear on the next 30s poll.
    }
  };

  const handleClick = async (n: AnyNotification) => {
    if (n.source === 'live') {
      const link = getLiveLink(n.type);
      if (link) {
        navigate(link);
        setOpen(false);
      }
      return;
    }
    // Inbox item: mark read, then follow link if present.
    if (!n.read_at) {
      setInboxItems(prev => prev.map(i =>
        i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i
      ));
      try { await notificationsAPI.markRead(n.id); } catch { /* reconcile on poll */ }
    }
    if (n.link) {
      navigate(n.link);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref} data-testid="notifications-panel">
      <button
        type="button"
        data-testid="notifications-bell"
        onClick={() => setOpen(!open)}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <Bell className="w-5 h-5 text-slate-500 dark:text-gray-400" aria-hidden="true" />
        {activeNotifications.length > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1",
              warningCount > 0 ? "bg-amber-500" : "bg-indigo-600"
            )}
          >
            {activeNotifications.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-[380px] bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50 animate-slide-in" data-testid="notifications-dropdown">
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-gray-100">Notifications</h3>
              {warningCount > 0 && (
                <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">
                  {warningCount} alerts
                </Badge>
              )}
            </div>
            {activeNotifications.length > 0 && (
              <button
                onClick={handleDismissAll}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                data-testid="dismiss-all-notifications"
              >
                Dismiss all
              </button>
            )}
          </div>

          <ScrollArea className="max-h-[400px]">
            {activeNotifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">All caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {activeNotifications.map(notification => {
                  const config = SEVERITY_CONFIG[notification.severity] || SEVERITY_CONFIG.info;
                  const Icon = config.icon;
                  const liveType = notification.source === 'live' ? notification.type : null;
                  const isIdle = liveType === 'idle_employee';
                  // The backend stores inbox bodies as plaintext (email
                  // rendering uses a separate HTML field), so we can render
                  // them directly as React text children — which escapes any
                  // angle brackets or entities for free.
                  const description = notification.source === 'live'
                    ? notification.description
                    : notification.body;
                  const hasLink = notification.source === 'live'
                    ? Boolean(getLiveLink(notification.type))
                    : Boolean(notification.link);
                  const isUnread = notification.source === 'inbox' && !notification.read_at;

                  const content = (
                    <>
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", config.bg)}>
                        {isIdle ? <UserX className={cn("w-4 h-4", config.color)} /> : <Icon className={cn("w-4 h-4", config.color)} />}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          {isUnread && (
                            <span
                              aria-label="Unread"
                              className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"
                            />
                          )}
                          <p className="text-sm font-medium text-slate-700 dark:text-gray-200 truncate">
                            {notification.title}
                          </p>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                          {description}
                        </p>
                        {hasLink && <p className="text-[10px] text-indigo-500 mt-1">Click to view</p>}
                      </div>
                    </>
                  );
                  return (
                    <div key={`${notification.source}-${notification.id}`} className="flex items-start gap-0" data-testid={`notification-${notification.id}`}>
                      {hasLink ? (
                        <button
                          type="button"
                          className="flex-1 p-4 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors flex gap-3 cursor-pointer appearance-none bg-transparent border-0 text-left"
                          onClick={() => handleClick(notification)}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="flex-1 p-4 flex gap-3">
                          {content}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleDismiss(notification); }}
                        className="text-muted-foreground hover:text-slate-500 shrink-0 p-4 pl-0"
                        aria-label="Dismiss notification"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Settings link — surfaces the preferences UI so users don't have
              to hunt through Settings for notification controls. */}
          <div className="p-2 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => { navigate('/settings#notifications'); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
              Notification settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

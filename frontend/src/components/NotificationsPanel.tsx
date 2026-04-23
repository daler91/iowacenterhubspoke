import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, CalendarDays, CheckCheck, UserX, X, Settings as SettingsIcon, WifiOff, RefreshCw, BellOff } from 'lucide-react';
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

function isAbortLike(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const name = (err as { name?: string })?.name;
  return code === 'ERR_CANCELED' || name === 'AbortError' || name === 'CanceledError';
}

const SEVERITY_CONFIG = {
  warning: { icon: AlertTriangle, color: 'text-warn', bg: 'bg-warn-soft', border: 'border-warn-soft' },
  info: { icon: CalendarDays, color: 'text-hub', bg: 'bg-hub-soft', border: 'border-hub-soft' },
};

export default function NotificationsPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);
  const [liveItems, setLiveItems] = useState<LiveNotification[]>([]);
  const [inboxItems, setInboxItems] = useState<InboxNotification[]>([]);
  const [dismissedLive, setDismissedLive] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState(false);
  const fetchOnceRef = useRef<(() => Promise<void>) | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Wait for the user to open the bell for the first time. Before that,
    // there is nothing to show, so a fetch/poll is pure waste on the
    // dashboard shell. Once opened, we behave exactly as before: immediate
    // fetch + 60s polling + visibility-triggered refresh.
    if (!hasInitialized) return;

    let currentController: AbortController | null = null;
    let lastFetchAt = 0;
    // Only refetch on visibility change if the tab was hidden long enough to
    // matter. Quick Alt-Tabs shouldn't trigger a round-trip; the 30s threshold
    // is well under the polling interval so we never starve the bell.
    const VISIBILITY_REFETCH_THRESHOLD_MS = 30_000;
    // Polling interval: was 30s, which meant 4 API calls/min on every tab
    // that had the app open. 60s halves the background traffic with no
    // perceptible UX change (notifications surface via inbox sync on user
    // action anyway).
    const POLL_INTERVAL_MS = 60_000;

    const fetchOnce = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      lastFetchAt = Date.now();
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
        const liveFailed = liveRes.status === 'rejected' && !isAbortLike(liveRes.reason);
        const inboxFailed = inboxRes.status === 'rejected' && !isAbortLike(inboxRes.reason);
        setFetchError(liveFailed && inboxFailed);
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
        if (controller.signal.aborted || isAbortLike(err)) return;
        // Network glitch — keep existing state rather than blanking the UI,
        // but surface a retry affordance to the user.
        setFetchError(true);
      }
    };

    fetchOnceRef.current = fetchOnce;
    fetchOnce();
    const interval = setInterval(fetchOnce, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (document.hidden) return;
      if (Date.now() - lastFetchAt < VISIBILITY_REFETCH_THRESHOLD_MS) return;
      fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      currentController?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      fetchOnceRef.current = null;
    };
  }, [hasInitialized]);

  const handleBellClick = () => {
    const next = !open;
    setOpen(next);
    if (next && !hasInitialized) setHasInitialized(true);
  };

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
  if (fetchError) {
    bellLabel = 'Notifications — failed to load';
  } else if (activeNotifications.length > 0) {
    bellLabel = `Notifications, ${activeNotifications.length} active`;
    if (warningCount > 0) {
      bellLabel += `, ${warningCount} alerts`;
    }
  }

  const handleRetryFetch = () => {
    setFetchError(false);
    fetchOnceRef.current?.();
  };

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
    // Hide live alerts client-side, then collapse all inbox dismissals
    // into a single backend round-trip via the bulk endpoint instead of
    // fanning out N DELETEs.
    setDismissedLive(new Set(liveItems.map(n => n.id)));
    setInboxItems([]);
    try {
      await notificationsAPI.dismissAll();
    } catch {
      // Any failed dismissals will reappear on the next poll.
    }
  };

  const handleMarkAllRead = async () => {
    // Mark every inbox item read without removing from the panel so the
    // user can still see their recent history. Live alerts don't have a
    // read/unread concept, so they're untouched.
    const now = new Date().toISOString();
    setInboxItems(prev => prev.map(i => i.read_at ? i : { ...i, read_at: now }));
    try {
      await notificationsAPI.markAllRead();
    } catch {
      // Next poll will reconcile any partial failure.
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
        onClick={handleBellClick}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors"
      >
        <Bell className="w-5 h-5 text-foreground/80 dark:text-muted-foreground" aria-hidden="true" />
        {activeNotifications.length > 0 && !fetchError && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1",
              warningCount > 0 ? "bg-warn" : "bg-hub"
            )}
          >
            {activeNotifications.length}
          </span>
        )}
        {fetchError && (
          <span
            aria-hidden="true"
            data-testid="notifications-error-dot"
            className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-danger border-2 border-white dark:border-border"
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-[min(380px,calc(100vw-1rem))] bg-white dark:bg-card rounded-lg shadow-xl border border-border z-50 animate-slide-in" data-testid="notifications-dropdown">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
              {warningCount > 0 && (
                <Badge className="bg-warn-soft text-warn border-0 text-[10px]">
                  {warningCount} alerts
                </Badge>
              )}
            </div>
            {activeNotifications.length > 0 && (
              <div className="flex items-center gap-3">
                {inboxItems.some(i => !i.read_at) && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    className="text-xs text-hub hover:text-hub-strong font-medium flex items-center gap-1"
                    data-testid="mark-all-read"
                    aria-label="Mark all as read"
                  >
                    <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    Mark all read
                  </button>
                )}
                <button
                  onClick={handleDismissAll}
                  className="text-xs text-hub hover:text-hub-strong font-medium"
                  data-testid="dismiss-all-notifications"
                >
                  Dismiss all
                </button>
              </div>
            )}
          </div>

          {fetchError && (
            <div
              role="alert"
              data-testid="notifications-fetch-error"
              className="px-4 py-3 border-b border-danger-soft dark:border-danger-soft/40 bg-danger-soft/10 flex items-center gap-3"
            >
              <WifiOff className="w-4 h-4 text-danger shrink-0" aria-hidden="true" />
              <p className="text-xs text-danger flex-1">
                Couldn't load notifications. Showing cached items.
              </p>
              <button
                type="button"
                onClick={handleRetryFetch}
                className="text-xs font-medium text-danger hover:text-danger dark:hover:text-danger-soft inline-flex items-center gap-1"
                data-testid="notifications-retry"
              >
                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          <ScrollArea className="max-h-[400px]">
            {activeNotifications.length === 0 ? (
              <div className="p-8 text-center">
                <BellOff className="w-8 h-8 text-muted-foreground dark:text-foreground mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">All caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
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
                              className="w-1.5 h-1.5 rounded-full bg-hub-strong shrink-0"
                            />
                          )}
                          <p className="text-sm font-medium text-foreground truncate">
                            {notification.title}
                          </p>
                        </div>
                        <p className="text-xs text-foreground/80 dark:text-muted-foreground mt-0.5 line-clamp-2">
                          {description}
                        </p>
                        {hasLink && <p className="text-[10px] text-hub mt-1">Click to view</p>}
                      </div>
                    </>
                  );
                  return (
                    <div key={`${notification.source}-${notification.id}`} className="flex items-start gap-0" data-testid={`notification-${notification.id}`}>
                      {hasLink ? (
                        <button
                          type="button"
                          className="flex-1 p-4 hover:bg-muted/50 transition-colors flex gap-3 cursor-pointer appearance-none bg-transparent border-0 text-left"
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
                        className="text-muted-foreground hover:text-foreground/80 shrink-0 p-4 pl-0"
                        aria-label="Dismiss notification"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {/* Settings link — surfaces the preferences UI so users don't have
              to hunt through Settings for notification controls. */}
          <div className="p-2 border-t border-border">
            <button
              type="button"
              onClick={() => { navigate('/settings#notifications'); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/80 dark:text-muted-foreground hover:bg-muted/50 dark:hover:bg-muted rounded-md transition-colors"
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

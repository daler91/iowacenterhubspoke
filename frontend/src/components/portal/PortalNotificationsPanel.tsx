import { useState, useEffect, useMemo, useRef } from 'react';
import { Bell, AlertTriangle, CalendarDays, CheckCheck, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { portalAPI } from '../../lib/coordination-api';
import { cn } from '../../lib/utils';

/**
 * Portal notifications bell.
 *
 * Mirrors the internal {@link NotificationsPanel} but:
 *
 * - Uses portal magic-link auth (Bearer token in every request).
 * - Only shows persistent inbox items — the `/notifications` live alerts
 *   endpoint is internal-only, and partners don't benefit from the
 *   upcoming-class / idle-employee feeds.
 * - The "Notification settings" link switches to the portal's Settings tab
 *   via an ``onOpenSettings`` callback rather than navigating to ``/settings``
 *   (the portal is a single-page layout with tab state).
 */

interface InboxNotification {
  readonly id: string;
  readonly type_key: string;
  readonly title: string;
  readonly body: string;
  readonly severity: 'info' | 'warning';
  readonly link: string | null;
  readonly read_at: string | null;
  readonly created_at: string;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

const SEVERITY_CONFIG = {
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  info: { icon: CalendarDays, color: 'text-indigo-600', bg: 'bg-indigo-50' },
};

interface Props {
  readonly token: string;
  readonly onOpenSettings?: () => void;
}

export default function PortalNotificationsPanel({ token, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    let controller: AbortController | null = null;
    const fetchOnce = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await portalAPI.inbox(token);
        const data = res.data as { items?: Record<string, unknown>[] };
        const raw = Array.isArray(data?.items) ? data.items : [];
        setItems(raw.map(n => ({
          id: asString(n.id),
          type_key: asString(n.type_key),
          title: asString(n.title),
          body: asString(n.body),
          severity: (n.severity === 'warning' ? 'warning' : 'info'),
          link: typeof n.link === 'string' ? n.link : null,
          read_at: typeof n.read_at === 'string' ? n.read_at : null,
          created_at: asString(n.created_at),
        })));
      } catch {
        // Network glitch — keep existing state rather than blanking.
      }
    };
    fetchOnce();
    // Jitter the polling interval (±5s) so concurrent partner sessions
    // don't synchronise into a thundering herd against the inbox endpoint.
    // Skip the API call entirely when the tab is hidden — the visibility
    // listener catches up when the user returns. crypto.getRandomValues
    // (vs Math.random) sidesteps the Sonar PRNG hotspot and is universally
    // supported in browsers we target.
    const jitterBuf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(jitterBuf);
    // Divide by 2**32 (max Uint32 + 1) to map the random word into [0, 1).
    const pollMs = 25000 + Math.floor((jitterBuf[0] / 4294967296) * 10000);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      fetchOnce();
    }, pollMs);
    const onVisibility = () => { if (!document.hidden) fetchOnce(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { unreadCount, warningCount } = useMemo(() => ({
    unreadCount: items.filter(i => !i.read_at).length,
    warningCount: items.filter(i => i.severity === 'warning').length,
  }), [items]);

  const handleDismiss = async (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await portalAPI.dismissInbox(token, id); } catch { /* next poll reconciles */ }
  };

  const handleMarkRead = async (id: string) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(i => i.id === id ? { ...i, read_at: now } : i));
    try { await portalAPI.markInboxRead(token, id); } catch { /* next poll reconciles */ }
  };

  const handleClickItem = async (n: InboxNotification) => {
    if (!n.read_at) await handleMarkRead(n.id);
    if (n.link) {
      // Absolute links from the backend point at the internal SPA; we just
      // open them in a new tab so the portal session stays intact.
      window.open(n.link, '_blank', 'noopener,noreferrer');
    }
    setOpen(false);
  };

  let bellLabel = 'Notifications';
  if (items.length > 0) {
    bellLabel = `Notifications, ${unreadCount} unread`;
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <Bell className="w-5 h-5 text-slate-500 dark:text-gray-400" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1',
              warningCount > 0 ? 'bg-amber-500' : 'bg-indigo-600',
            )}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-12 w-[360px] max-w-[90vw] bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-50"
        >
          <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-gray-100">
                Notifications
              </h3>
              {warningCount > 0 && (
                <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">
                  {warningCount} alerts
                </Badge>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const now = new Date().toISOString();
                  setItems(prev => prev.map(i => i.read_at ? i : { ...i, read_at: now }));
                  // Portal has no batch endpoint yet; mark each unread one.
                  const unread = items.filter(i => !i.read_at);
                  try {
                    await Promise.all(unread.map(i => portalAPI.markInboxRead(token, i.id)));
                  } catch { /* reconcile on poll */ }
                }}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1 shrink-0"
                aria-label="Mark all as read"
              >
                <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          <ScrollArea className="max-h-[400px]">
            {items.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-gray-200 dark:text-gray-700 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">All caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                {items.map(n => {
                  const config = SEVERITY_CONFIG[n.severity] || SEVERITY_CONFIG.info;
                  const Icon = config.icon;
                  const isUnread = !n.read_at;
                  const hasLink = Boolean(n.link);
                  return (
                    <div key={n.id} className="flex items-start gap-0">
                      {hasLink ? (
                        <button
                          type="button"
                          className="flex-1 p-4 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors flex gap-3 appearance-none bg-transparent border-0 text-left"
                          onClick={() => handleClickItem(n)}
                        >
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', config.bg)}>
                            <Icon className={cn('w-4 h-4', config.color)} aria-hidden="true" />
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
                                {n.title}
                              </p>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                              {n.body}
                            </p>
                          </div>
                        </button>
                      ) : (
                        <div className="flex-1 p-4 flex gap-3">
                          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', config.bg)}>
                            <Icon className={cn('w-4 h-4', config.color)} aria-hidden="true" />
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
                                {n.title}
                              </p>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                              {n.body}
                            </p>
                          </div>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleDismiss(n.id); }}
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

          {onOpenSettings && (
            <div className="p-2 border-t border-gray-100 dark:border-gray-800">
              <button
                type="button"
                onClick={() => { onOpenSettings(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-md transition-colors"
              >
                Notification settings
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

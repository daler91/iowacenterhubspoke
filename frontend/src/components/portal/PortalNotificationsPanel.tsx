import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Bell, CalendarDays, CheckCheck, RefreshCw, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { portalAPI } from '../../lib/coordination-api';
import { mapAppPathToPortalPath, normalizeAppLink } from '../../lib/appLinks';
import { cn } from '../../lib/utils';
import { runPortalAsync } from './async';

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

interface Props {
  readonly token: string;
  readonly onOpenSettings?: () => void;
}

const SEVERITY_CONFIG = {
  warning: { icon: AlertTriangle, color: 'text-warn-strong', bg: 'bg-warn-soft' },
  info: { icon: CalendarDays, color: 'text-hub', bg: 'bg-hub-soft' },
};

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function mapNotification(n: Record<string, unknown>): InboxNotification {
  return {
    id: asString(n.id),
    type_key: asString(n.type_key),
    title: asString(n.title),
    body: asString(n.body),
    severity: n.severity === 'warning' ? 'warning' : 'info',
    link: typeof n.link === 'string' ? n.link : null,
    read_at: typeof n.read_at === 'string' ? n.read_at : null,
    created_at: asString(n.created_at),
  };
}

export default function PortalNotificationsPanel({ token, onOpenSettings }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  const fetchInbox = useCallback(async (showLoading = false) => {
    if (!token) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (showLoading || status === 'idle') setStatus('loading');
    setErrorMessage('');
    try {
      const res = await portalAPI.inbox(token);
      const data = res.data as { items?: Record<string, unknown>[] };
      const raw = Array.isArray(data?.items) ? data.items : [];
      setItems(raw.map(mapNotification));
      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMessage("We couldn't load portal notifications.");
    }
  }, [status, token]);

  useEffect(() => {
    if (open && status === 'idle') {
      runPortalAsync(fetchInbox(true), 'load portal notifications');
    }
  }, [fetchInbox, open, status]);

  useEffect(() => {
    if (!token || status === 'idle') return;

    const jitterBuf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(jitterBuf);
    const pollMs = 25000 + Math.floor((jitterBuf[0] / 4294967296) * 10000);
    const refreshInbox = () => {
      runPortalAsync(fetchInbox(false), 'refresh portal notifications');
    };
    const interval = setInterval(refreshInbox, pollMs);
    const onVisibility = () => {
      if (!document.hidden) refreshInbox();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchInbox, status, token]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return;
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
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
    try {
      await portalAPI.dismissInbox(token, id);
    } catch {
      runPortalAsync(fetchInbox(false), 'reload portal notifications after dismiss failed');
    }
  };

  const handleMarkRead = async (id: string) => {
    const now = new Date().toISOString();
    setItems(prev => prev.map(i => (i.id === id ? { ...i, read_at: now } : i)));
    try {
      await portalAPI.markInboxRead(token, id);
    } catch {
      runPortalAsync(fetchInbox(false), 'reload portal notifications after mark read failed');
    }
  };

  const handleMarkAllRead = async () => {
    const now = new Date().toISOString();
    const unread = items.filter(i => !i.read_at);
    setItems(prev => prev.map(i => (i.read_at ? i : { ...i, read_at: now })));
    try {
      await Promise.all(unread.map(i => portalAPI.markInboxRead(token, i.id)));
    } catch {
      runPortalAsync(fetchInbox(false), 'reload portal notifications after mark all read failed');
    }
  };

  const handleClickItem = async (n: InboxNotification) => {
    if (!n.read_at) await handleMarkRead(n.id);
    if (n.link) {
      const normalized = normalizeAppLink(n.link);
      if (normalized.kind === 'app') {
        const portalPath = mapAppPathToPortalPath(normalized.path, token);
        if (portalPath) {
          navigate(portalPath);
        } else {
          window.open(normalized.path, '_blank', 'noopener,noreferrer');
        }
      } else if (normalized.kind === 'external') {
        window.open(normalized.href, '_blank', 'noopener,noreferrer');
      }
    }
    setOpen(false);
  };

  let bellLabel = 'Notifications';
  if (status === 'error') bellLabel = 'Notifications unavailable';
  if (items.length > 0) bellLabel = `Notifications, ${unreadCount} unread`;

  return (
    <div className="relative" ref={ref} data-testid="portal-notifications">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub"
        data-testid="portal-notifications-bell"
      >
        <Bell className="w-5 h-5 text-foreground/80 dark:text-muted-foreground" aria-hidden="true" />
        {(unreadCount > 0 || status === 'error') && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[10px] font-bold text-white px-1',
              status === 'error' || warningCount > 0 ? 'bg-warn' : 'bg-hub',
            )}
          >
            {status === 'error' ? '!' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-12 w-[min(380px,calc(100vw-1rem))] bg-white dark:bg-card rounded-lg shadow-xl border border-border z-50"
          role="dialog"
          aria-label="Portal notifications"
          data-testid="portal-notifications-panel"
        >
          <div className="p-4 border-b border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                Notifications
              </h3>
              {warningCount > 0 && (
                <Badge className="bg-warn-soft text-warn-strong border-0 text-[10px]">
                  {warningCount} alerts
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {status === 'error' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    runPortalAsync(fetchInbox(true), 'retry portal notifications');
                  }}
                  aria-label="Retry notifications"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              )}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    runPortalAsync(handleMarkAllRead(), 'mark all portal notifications read');
                  }}
                  className="text-xs text-hub hover:text-hub-strong font-medium flex items-center gap-1"
                  aria-label="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {status === 'error' && (
            <div className="m-3 rounded-lg border border-warn/30 bg-warn-soft p-3" role="alert">
              <p className="text-xs font-medium text-foreground">{errorMessage}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  runPortalAsync(fetchInbox(true), 'retry portal notifications');
                }}
              >
                Retry
              </Button>
            </div>
          )}

          <div className="max-h-[400px] overflow-y-auto">
            {status === 'loading' && items.length === 0 ? (
              <output className="block p-8 text-center text-sm text-muted-foreground" aria-live="polite">
                Loading notifications...
              </output>
            ) : items.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-8 h-8 text-muted-foreground dark:text-foreground mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">All caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {items.map(n => {
                  const config = SEVERITY_CONFIG[n.severity] || SEVERITY_CONFIG.info;
                  const Icon = config.icon;
                  const isUnread = !n.read_at;
                  const hasLink = Boolean(n.link);
                  const content = (
                    <>
                      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', config.bg)}>
                        <Icon className={cn('w-4 h-4', config.color)} aria-hidden="true" />
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
                            {n.title}
                          </p>
                        </div>
                        <p className="text-xs text-foreground/80 dark:text-muted-foreground mt-0.5 line-clamp-2">
                          {n.body}
                        </p>
                      </div>
                    </>
                  );
                  return (
                    <div key={n.id} className="flex items-start gap-0">
                      {hasLink ? (
                        <button
                          type="button"
                          className="flex-1 p-4 hover:bg-muted/50 transition-colors flex gap-3 appearance-none bg-transparent border-0 text-left"
                          onClick={() => {
                            runPortalAsync(handleClickItem(n), 'open portal notification');
                          }}
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
                        onClick={(e) => {
                          e.stopPropagation();
                          runPortalAsync(handleDismiss(n.id), 'dismiss portal notification');
                        }}
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
          </div>

          {onOpenSettings && (
            <div className="p-2 border-t border-border">
              <button
                type="button"
                onClick={() => { onOpenSettings(); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/80 dark:text-muted-foreground hover:bg-muted/50 dark:hover:bg-muted rounded-md transition-colors"
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

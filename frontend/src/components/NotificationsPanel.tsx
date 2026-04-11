import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, CalendarDays, UserX, X } from 'lucide-react';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';
import { cn } from '../lib/utils';

function getNotificationLink(notification: { type?: string; id?: string }): string | null {
  const { type } = notification;
  if (type === 'upcoming_class' || type === 'town_to_town') return '/calendar';
  if (type === 'idle_employee') return '/employees';
  return null;
}

const SEVERITY_CONFIG = {
  warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  info: { icon: CalendarDays, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
};

export default function NotificationsPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [dismissed, setDismissed] = useState(new Set());
  const ref = useRef(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await api.get('/notifications');
        // Ensure notifications is always an array
        setNotifications(Array.isArray(res.data) ? res.data : []);
      } catch {
        setNotifications([]);
      }
    };
    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const safeNotifications = Array.isArray(notifications) ? notifications : [];
  const activeNotifications = safeNotifications.filter(n => !dismissed.has(n.id));
  const warningCount = activeNotifications.filter(n => n.severity === 'warning').length;

  // Build the accessible bell label once so the JSX stays free of
  // nested ternaries / nested template literals (Sonar S3358 / S4624).
  let bellLabel = 'Notifications';
  if (activeNotifications.length > 0) {
    bellLabel = `Notifications, ${activeNotifications.length} active`;
    if (warningCount > 0) {
      bellLabel += `, ${warningCount} alerts`;
    }
  }

  return (
    <div className="relative" ref={ref} data-testid="notifications-panel">
      {/* Bell button */}
      <button
        type="button"
        data-testid="notifications-bell"
        onClick={() => setOpen(!open)}
        aria-label={bellLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
      >
        <Bell className="w-5 h-5 text-slate-500" aria-hidden="true" />
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

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-12 w-[380px] bg-white rounded-lg shadow-xl border border-gray-200 z-50 animate-slide-in" data-testid="notifications-dropdown">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Notifications</h3>
              {warningCount > 0 && (
                <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">
                  {warningCount} alerts
                </Badge>
              )}
            </div>
            {activeNotifications.length > 0 && (
              <button
                onClick={() => setDismissed(new Set(safeNotifications.map(n => n.id)))}
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
                <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">All caught up!</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {activeNotifications.map(notification => {
                  const config = SEVERITY_CONFIG[notification.severity] || SEVERITY_CONFIG.info;
                  const Icon = config.icon;
                  const isIdle = notification.type === 'idle_employee';

                  const link = getNotificationLink(notification);
                  const content = (
                    <>
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", config.bg)}>
                        {isIdle ? <UserX className={cn("w-4 h-4", config.color)} /> : <Icon className={cn("w-4 h-4", config.color)} />}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-sm font-medium text-slate-700">{notification.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{notification.description}</p>
                        {link && <p className="text-[10px] text-indigo-500 mt-1">Click to view</p>}
                      </div>
                    </>
                  );
                  return (
                    <div key={notification.id} className="flex items-start gap-0" data-testid={`notification-${notification.id}`}>
                      {link ? (
                        <button
                          type="button"
                          className="flex-1 p-4 hover:bg-gray-50/50 transition-colors flex gap-3 cursor-pointer appearance-none bg-transparent border-0 text-left"
                          onClick={() => { navigate(link); setOpen(false); }}
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
                        onClick={(e) => { e.stopPropagation(); setDismissed(prev => new Set([...prev, notification.id])); }}
                        className="text-slate-300 hover:text-slate-500 shrink-0 p-4 pl-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

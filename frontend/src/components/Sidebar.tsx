import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import {
  CalendarDays, MapPin, Users, Shield,
  Map, LogOut, ChevronLeft, ChevronRight, Plus,
  ListChecks, BarChart3, BookOpen, Briefcase,
  Moon, Sun, Settings, LayoutDashboard, Handshake, Webhook,
} from 'lucide-react';
import { cn } from '../lib/utils';

const NAV_SECTIONS = [
  {
    id: 'planning',
    label: 'Planning',
    items: [
      { id: 'calendar', path: '/calendar', label: 'Calendar', icon: CalendarDays, tooltip: 'Weekly, daily, monthly class calendar' },
      { id: 'map', path: '/map', label: 'Map View', icon: Map, tooltip: 'Geographic view of hub & spoke locations' },
      { id: 'kanban', path: '/kanban', label: 'Schedule Tracker', icon: ListChecks, tooltip: 'Track class delivery status' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: 'insights', path: '/insights', label: 'Insights', icon: BarChart3, tooltip: 'Reports, workload, analytics, activity' },
    ],
  },
  {
    id: 'coordination',
    label: 'Coordination',
    items: [
      { id: 'coord-dashboard', path: '/coordination', label: 'Dashboard', icon: LayoutDashboard, tooltip: 'Multi-community coordination overview' },
      { id: 'coord-board', path: '/coordination/board', label: 'Projects', icon: Briefcase, tooltip: 'Manage partner coordination projects' },
      { id: 'coord-partners', path: '/coordination/partners', label: 'Partners', icon: Handshake, tooltip: 'Partner organizations & contacts' },
      { id: 'coord-webhooks', path: '/coordination/webhooks', label: 'Webhooks', icon: Webhook, adminOnly: true, tooltip: 'External integrations' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { id: 'classes', path: '/classes', label: 'Classes', icon: BookOpen, tooltip: 'Class types and formats' },
      { id: 'employees', path: '/employees', label: 'Employees', icon: Users, tooltip: 'Instructors and coordinators' },
      { id: 'locations', path: '/locations', label: 'Locations', icon: MapPin, tooltip: 'Hub & spoke cities' },
      { id: 'users', path: '/users', label: 'Users', icon: Shield, adminOnly: true, tooltip: 'User accounts and roles' },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle, onNewSchedule }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const filterItems = (items) => items.filter(item => !item.adminOnly || user?.role === 'admin');
  const flatNavItems = NAV_SECTIONS.flatMap((section) => filterItems(section.items));

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;

    return (
      <button
        key={item.id}
        type="button"
        data-testid={`nav-${item.id}`}
        aria-label={collapsed ? item.label : undefined}
        aria-current={isActive ? 'page' : undefined}
        title={collapsed ? item.tooltip || item.label : item.tooltip}
        onClick={() => {
          navigate(item.path);
        }}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
          isActive
            ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 shadow-sm'
            : 'text-slate-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-slate-700 dark:hover:text-slate-200',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon aria-hidden="true" className={cn('w-5 h-5 shrink-0', isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400')} />
        {!collapsed && <span>{item.label}</span>}
      </button>
    );
  };

  return (
    <div
      data-testid="sidebar"
      className={cn(
        "h-screen bg-white dark:bg-gray-950 border-r border-gray-100 dark:border-gray-800 flex flex-col transition-all duration-300 shadow-sm",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="p-4 flex items-center gap-3 border-b border-gray-100 dark:border-gray-800">
        <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
            HubSpoke
          </span>
        )}
      </div>

      {/* New Schedule Button */}
      {user?.role !== 'viewer' && (
        <div className="p-3">
          <Button
            data-testid="new-schedule-btn"
            onClick={onNewSchedule}
            className={cn(
              "bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-all shadow-sm hover:shadow-md",
              collapsed ? "w-full px-0 justify-center" : "w-full"
            )}
          >
            <Plus className="w-4 h-4" />
            {!collapsed && <span className="ml-2">New Schedule</span>}
          </Button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {collapsed ? (
          <div className="space-y-1">
            {flatNavItems.map(renderNavItem)}
          </div>
        ) : (
          <div className="space-y-5">
            {NAV_SECTIONS.map((section) => (
              <div key={section.id} className="space-y-1.5" data-testid={`nav-section-${section.id}`}>
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600">
                  {section.label}
                </p>
                <div className="space-y-1">
                  {filterItems(section.items).map(renderNavItem)}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 dark:border-gray-800 p-3">
        {!collapsed && user && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-semibold text-sm">
              {user.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{user.name}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold uppercase tracking-wider">
                  {user.role}
                </span>
              </div>
            </div>
          </div>
        )}
        <button
          type="button"
          data-testid="settings-btn"
          aria-label={collapsed ? 'Settings' : undefined}
          aria-current={location.pathname === '/settings' ? 'page' : undefined}
          onClick={() => navigate('/settings')}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
            location.pathname === '/settings'
              ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300"
              : "text-slate-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-slate-700 dark:hover:text-slate-200",
            collapsed && "justify-center"
          )}
        >
          <Settings aria-hidden="true" className={cn("w-5 h-5 shrink-0", location.pathname === '/settings' ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400")} />
          {!collapsed && <span>Settings</span>}
        </button>
        <button
          type="button"
          data-testid="theme-toggle"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'dark'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-slate-700 dark:hover:text-slate-200 transition-all",
            collapsed && "justify-center"
          )}
        >
          {theme === 'dark'
            ? <Sun aria-hidden="true" className="w-5 h-5 shrink-0" />
            : <Moon aria-hidden="true" className="w-5 h-5 shrink-0" />
          }
          {!collapsed && <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
        <button
          type="button"
          data-testid="logout-btn"
          aria-label={collapsed ? 'Sign out' : undefined}
          onClick={logout}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 dark:text-slate-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 transition-all",
            collapsed && "justify-center"
          )}
        >
          <LogOut aria-hidden="true" className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        data-testid="sidebar-toggle"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        onClick={onToggle}
        className="absolute top-1/2 -right-3 w-6 h-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full flex items-center justify-center shadow-sm hover:shadow-md transition-all z-40"
      >
        {collapsed ? <ChevronRight aria-hidden="true" className="w-3 h-3" /> : <ChevronLeft aria-hidden="true" className="w-3 h-3" />}
      </button>
    </div>
  );
}


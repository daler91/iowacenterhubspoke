import { useNavigate, useLocation } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import {
  CalendarDays, MapPin, Users,
  Map, LogOut, ChevronLeft, ChevronRight, Plus,
  Kanban, BarChart3, Activity, FileText, BookOpen, TrendingUp
} from 'lucide-react';
import { cn } from '../lib/utils';

const NAV_SECTIONS = [
  {
    id: 'planning',
    label: 'Planning',
    items: [
      { id: 'calendar', path: '/calendar', label: 'Calendar', icon: CalendarDays },
      { id: 'map', path: '/map', label: 'Map View', icon: Map },
      { id: 'kanban', path: '/kanban', label: 'Status Board', icon: Kanban },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [
      { id: 'workload', path: '/workload', label: 'Workload', icon: BarChart3 },
      { id: 'report', path: '/report', label: 'Weekly Report', icon: FileText },
      { id: 'analytics', path: '/analytics', label: 'Analytics', icon: TrendingUp },
      { id: 'activity', path: '/activity', label: 'Activity', icon: Activity },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { id: 'classes', path: '/classes', label: 'Classes', icon: BookOpen },
      { id: 'employees', path: '/employees', label: 'Employees', icon: Users },
      { id: 'locations', path: '/locations', label: 'Locations', icon: MapPin },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle, onNewSchedule }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const flatNavItems = NAV_SECTIONS.flatMap((section) => section.items);

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const isActive = location.pathname === item.path;

    return (
      <button
        key={item.id}
        data-testid={`nav-${item.id}`}
        onClick={() => {
          navigate(item.path);
          if (window.innerWidth < 768) {
             // Close mobile sidebar if needed, but Sidebar is usually managed by parent
             // This component currently doesn't have a closeSidebar prop, but onViewChange used to handle it in DashboardPage
          }
        }}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
          isActive
            ? 'bg-indigo-50 text-indigo-700 shadow-sm'
            : 'text-slate-500 hover:bg-gray-50 hover:text-slate-700',
          collapsed && 'justify-center px-0',
        )}
      >
        <Icon className={cn('w-5 h-5 shrink-0', isActive ? 'text-indigo-600' : 'text-slate-400')} />
        {!collapsed && <span>{item.label}</span>}
      </button>
    );
  };

  return (
    <div
      data-testid="sidebar"
      className={cn(
        "h-screen bg-white border-r border-gray-100 flex flex-col transition-all duration-300 shadow-sm",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="p-4 flex items-center gap-3 border-b border-gray-100">
        <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
          <MapPin className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <span className="font-bold text-lg text-slate-900" style={{ fontFamily: 'Manrope, sans-serif' }}>
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
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                  {section.label}
                </p>
                <div className="space-y-1">
                  {section.items.map(renderNavItem)}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* User section */}
      <div className="border-t border-gray-100 p-3">
        {!collapsed && user && (
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm">
              {user.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-bold uppercase tracking-wider">
                  {user.role}
                </span>
              </div>
            </div>
          </div>
        )}
        <button
          data-testid="logout-btn"
          onClick={logout}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all",
            collapsed && "justify-center"
          )}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        data-testid="sidebar-toggle"
        onClick={onToggle}
        className="absolute top-1/2 -right-3 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:shadow-md transition-all z-40"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
      </button>
    </div>
  );
}

Sidebar.propTypes = {
  collapsed: PropTypes.bool,
  onToggle: PropTypes.func,
  onNewSchedule: PropTypes.func,
};

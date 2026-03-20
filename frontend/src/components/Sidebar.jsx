import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import {
  CalendarDays, MapPin, Users, LayoutDashboard,
  Map, LogOut, ChevronLeft, ChevronRight, Plus
} from 'lucide-react';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'map', label: 'Map View', icon: Map },
  { id: 'locations', label: 'Locations', icon: MapPin },
  { id: 'employees', label: 'Employees', icon: Users },
];

export default function Sidebar({ activeView, onViewChange, collapsed, onToggle, onNewSchedule }) {
  const { user, logout } = useAuth();

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

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              data-testid={`nav-${item.id}`}
              onClick={() => onViewChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:bg-gray-50 hover:text-slate-700"
              )}
            >
              <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-indigo-600" : "text-slate-400")} />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
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
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
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

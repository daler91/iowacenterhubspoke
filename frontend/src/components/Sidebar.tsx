import { useNavigate, useLocation } from 'react-router-dom';
import { useTheme } from 'next-themes';
import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import { Logo } from './ui/logo';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
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
      { id: 'kanban', path: '/kanban', label: 'Delivery Pipeline', icon: ListChecks, tooltip: 'Track class delivery status' },
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

/**
 * Sidebar nav item. Extracted from the `Sidebar` function body so its
 * conditional rendering doesn't inflate the parent's cognitive
 * complexity (SonarCloud S3776 counter).
 */
function SidebarNavItem({ item, collapsed, isActive, onNavigate }) {
  const Icon = item.icon;
  const button = (
    <Button
      type="button"
      variant="ghost"
      data-testid={`nav-${item.id}`}
      aria-label={collapsed ? item.label : undefined}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        // Reset the Button primitive's default horizontal layout so the
        // sidebar can own width/padding/active-state styling.
        'h-auto w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
        isActive
          ? 'bg-hub-soft text-hub-strong hover:bg-hub-soft shadow-sm'
          : 'text-foreground/80 hover:bg-muted hover:text-foreground',
        collapsed && 'justify-center px-0',
      )}
    >
      <Icon aria-hidden="true" className={cn('w-5 h-5 shrink-0', isActive ? 'text-hub' : 'text-muted-foreground')} />
      {!collapsed && <span>{item.label}</span>}
    </Button>
  );
  // Only wire a Radix Tooltip in the collapsed state — the expanded
  // sidebar already shows the label, and Radix tooltips (unlike the
  // native `title` attribute) surface on keyboard focus, which is the
  // whole reason we're swapping here.
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{item.tooltip || item.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * User section at the bottom of the sidebar — avatar/email/role
 * summary, then Settings / Theme toggle / Sign out action buttons.
 * Extracted from the `Sidebar` function body because its three
 * Button sub-sections with collapsed/active ternaries were the
 * main source of cognitive complexity in the parent (S3776).
 */
function SidebarUserFooter({ collapsed, user, location, navigate, theme, setTheme, logout }) {
  const isSettingsActive = location.pathname === '/settings';
  const isDark = theme === 'dark';
  return (
    <div className="border-t border-border p-3">
      {!collapsed && user && (
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <div className="w-8 h-8 rounded-full bg-hub-soft flex items-center justify-center text-hub-strong font-semibold text-sm">
            {user.name?.charAt(0)?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-bold uppercase tracking-wider">
                {user.role}
              </span>
            </div>
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        data-testid="settings-btn"
        aria-label={collapsed ? 'Settings' : undefined}
        aria-current={isSettingsActive ? 'page' : undefined}
        onClick={() => navigate('/settings')}
        className={cn(
          'h-auto w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
          isSettingsActive
            ? 'bg-hub-soft text-hub-strong hover:bg-hub-soft'
            : 'text-foreground/80 hover:bg-muted hover:text-foreground',
          collapsed && 'justify-center px-0',
        )}
      >
        <Settings aria-hidden="true" className={cn('w-5 h-5 shrink-0', isSettingsActive ? 'text-hub' : 'text-muted-foreground')} />
        {!collapsed && <span>Settings</span>}
      </Button>
      <Button
        type="button"
        variant="ghost"
        data-testid="theme-toggle"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-pressed={isDark}
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        className={cn(
          'h-auto w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-foreground/80 hover:bg-muted hover:text-foreground transition-all',
          collapsed && 'justify-center px-0',
        )}
      >
        <SidebarThemeIcon isDark={isDark} />
        {!collapsed && <span>{isDark ? 'Light Mode' : 'Dark Mode'}</span>}
      </Button>
      <Button
        type="button"
        variant="ghost"
        data-testid="logout-btn"
        aria-label={collapsed ? 'Sign out' : undefined}
        onClick={logout}
        className={cn(
          'h-auto w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-foreground/80 hover:bg-danger-soft hover:text-danger-strong transition-all',
          collapsed && 'justify-center px-0',
        )}
      >
        <LogOut aria-hidden="true" className="w-5 h-5 shrink-0" />
        {!collapsed && <span>Sign Out</span>}
      </Button>
      {!collapsed && (
        <a
          href="/privacy"
          className="mt-1 block text-center text-[11px] text-muted-foreground hover:text-foreground focus-visible:underline"
        >
          Privacy policy
        </a>
      )}
    </div>
  );
}

function SidebarThemeIcon({ isDark }) {
  return isDark
    ? <Sun aria-hidden="true" className="w-5 h-5 shrink-0" />
    : <Moon aria-hidden="true" className="w-5 h-5 shrink-0" />;
}

export default function Sidebar({ collapsed, onToggle, onNewSchedule }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const filterItems = (items) => items.filter(item => !item.adminOnly || user?.role === 'admin');
  const flatNavItems = NAV_SECTIONS.flatMap((section) => filterItems(section.items));

  const renderNavItem = (item) => (
    <SidebarNavItem
      key={item.id}
      item={item}
      collapsed={collapsed}
      isActive={location.pathname === item.path}
      onNavigate={() => navigate(item.path)}
    />
  );

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
    <div
      data-testid="sidebar"
      className={cn(
        "h-screen bg-card border-r border-border flex flex-col transition-all duration-300 shadow-sm",
        collapsed ? "w-[68px]" : "w-[260px]"
      )}
    >
      {/* Logo */}
      <div className="p-4 flex items-center gap-3 border-b border-border">
        <Logo aria-hidden="true" className="size-9 text-hub shrink-0" />
        {!collapsed && (
          <span className="font-bold text-lg text-foreground font-display">
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
              "bg-hub hover:bg-hub-strong text-white rounded-lg font-medium transition-all shadow-sm hover:shadow-md",
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
                <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
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
      <SidebarUserFooter
        collapsed={collapsed}
        user={user}
        location={location}
        navigate={navigate}
        theme={theme}
        setTheme={setTheme}
        logout={logout}
      />

      {/* Collapse toggle */}
      <Button
        type="button"
        variant="outline"
        size="icon"
        data-testid="sidebar-toggle"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        onClick={onToggle}
        className="absolute top-1/2 -right-3 h-6 w-6 bg-card border border-border rounded-full flex items-center justify-center shadow-sm hover:shadow-md transition-all z-40 p-0"
      >
        {collapsed ? <ChevronRight aria-hidden="true" className="w-3 h-3" /> : <ChevronLeft aria-hidden="true" className="w-3 h-3" />}
      </Button>
    </div>
    </TooltipProvider>
  );
}


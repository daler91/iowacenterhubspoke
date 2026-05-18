import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from 'next-themes';
import {
  Briefcase,
  CheckSquare,
  FileText,
  LayoutDashboard,
  Menu,
  MessagesSquare,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Logo } from '../ui/logo';
import { cn } from '../../lib/utils';
import type { PartnerContact, PartnerOrg, PortalNavItem } from '../../lib/coordination-types';
import PortalNotificationsPanel from './PortalNotificationsPanel';

interface Props {
  readonly token: string;
  readonly org: PartnerOrg;
  readonly contact: PartnerContact;
  readonly activeSection: string;
  readonly children: ReactNode;
}

function portalPath(token: string, section: string) {
  if (section === 'home') return `/portal/${token}`;
  return `/portal/${token}/${section}`;
}

function navItems(token: string): PortalNavItem[] {
  return [
    { id: 'home', label: 'Home', path: portalPath(token, 'home'), icon: LayoutDashboard },
    { id: 'projects', label: 'Projects', path: portalPath(token, 'projects'), icon: Briefcase },
    { id: 'tasks', label: 'Tasks', path: portalPath(token, 'tasks'), icon: CheckSquare },
    { id: 'documents', label: 'Documents', path: portalPath(token, 'documents'), icon: FileText },
    { id: 'messages', label: 'Messages', path: portalPath(token, 'messages'), icon: MessagesSquare },
    { id: 'settings', label: 'Settings', path: portalPath(token, 'settings'), icon: Settings },
  ];
}

function PortalNav({
  items,
  activeSection,
  onNavigate,
}: Readonly<{
  items: PortalNavItem[];
  activeSection: string;
  onNavigate: (path: string) => void;
}>) {
  return (
    <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Partner portal sections">
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeSection === item.id;
        return (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            data-testid={`portal-nav-${item.id}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(item.path)}
            className={cn(
              'h-auto w-full justify-start gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all',
              active
                ? 'bg-hub-soft text-hub-strong hover:bg-hub-soft shadow-sm'
                : 'text-foreground/80 hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon
              className={cn('h-5 w-5 shrink-0', active ? 'text-hub' : 'text-muted-foreground')}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </Button>
        );
      })}
    </nav>
  );
}

function ContactFooter({
  contact,
  org,
  theme,
  onToggleTheme,
}: Readonly<{
  contact: PartnerContact;
  org: PartnerOrg;
  theme?: string;
  onToggleTheme: () => void;
}>) {
  const initial = contact.name?.charAt(0)?.toUpperCase() || 'P';
  const dark = theme === 'dark';
  return (
    <div className="border-t border-border p-3 space-y-2">
      <div className="flex items-center gap-3 px-3 py-2 min-w-0">
        <div className="h-9 w-9 rounded-full bg-spoke-soft text-spoke-strong flex items-center justify-center font-semibold">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{contact.name}</p>
          <p className="truncate text-xs text-muted-foreground">{contact.email}</p>
        </div>
      </div>
      <div className="px-3 text-[11px] text-muted-foreground">
        <p className="truncate font-medium text-foreground/80">{org.name}</p>
        <p className="truncate">{org.community}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        onClick={onToggleTheme}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-pressed={dark}
        className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-sm text-foreground/80 hover:bg-muted"
        data-testid="portal-theme-toggle"
      >
        {dark ? (
          <Sun className="h-5 w-5 shrink-0" aria-hidden="true" />
        ) : (
          <Moon className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>
      </Button>
      <a
        href="/privacy"
        className="block px-3 pb-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub rounded"
      >
        Privacy policy
      </a>
    </div>
  );
}

export default function PortalShell({
  token,
  org,
  contact,
  activeSection,
  children,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();
  const items = useMemo(() => navItems(token), [token]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const go = (path: string) => navigate(path);
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const sidebar = (
    <div
      className="h-screen w-[260px] bg-card border-r border-border flex flex-col shadow-sm"
      data-testid="portal-sidebar"
    >
      <div className="p-4 flex items-center gap-3 border-b border-border">
        <Logo className="size-9 text-hub shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-bold text-lg text-foreground font-display">HubSpoke</p>
          <p className="text-xs text-muted-foreground">Partner Portal</p>
        </div>
      </div>
      <PortalNav items={items} activeSection={activeSection} onNavigate={go} />
      <ContactFooter contact={contact} org={org} theme={theme} onToggleTheme={toggleTheme} />
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden" data-testid="portal-shell">
      <a
        href="#portal-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-card focus:text-hub focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-hub"
        data-testid="portal-skip-to-content"
      >
        Skip to main content
      </a>

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        id="portal-sidebar"
        className={cn(
          'fixed left-0 top-0 z-50 h-full transition-transform duration-300 md:relative md:z-auto md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close navigation menu"
            className="absolute right-2 top-2 md:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
          {sidebar}
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header
          className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-border bg-card shrink-0"
          data-testid="portal-top-bar"
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            aria-controls="portal-sidebar"
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            data-testid="portal-mobile-menu-btn"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{org.name}</p>
            <p className="text-xs text-muted-foreground truncate hidden sm:block">{org.community}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <PortalNotificationsPanel
              token={token}
              onOpenSettings={() => navigate(portalPath(token, 'settings'))}
            />
          </div>
        </header>
        <main
          id="portal-main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8"
          data-testid="portal-main-content"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

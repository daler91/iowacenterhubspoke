import type { ReactNode } from 'react';
import type { PartnerOrg, PartnerContact } from '../../lib/coordination-types';
import { cn } from '../../lib/utils';
import PortalNotificationsPanel from './PortalNotificationsPanel';

interface Props {
  readonly org: PartnerOrg;
  readonly contact: PartnerContact;
  readonly activeTab: string;
  readonly onTabChange: (tab: string) => void;
  readonly children: ReactNode;
  /** Magic-link token — when set, shows the notifications bell. */
  readonly token?: string;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Your Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'messages', label: 'Messages' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Shell for the partner portal (authenticated via magic link, no sidebar).
 *
 * Mobile-first: partners typically access via phone. Header stacks its
 * org/contact blocks on narrow screens, the tab bar scrolls horizontally
 * instead of overflowing, and content has fluid padding (16px phone →
 * 24px tablet → 32px desktop).
 */
export default function PortalLayout({
  org, contact, activeTab, onTabChange, children, token,
}: Props) {
  return (
    <div className="min-h-screen bg-muted/50 dark:bg-background">
      {/* Header */}
      <header className="bg-white dark:bg-card border-b border-border px-4 sm:px-6 py-3 sm:py-4">
        <div className="max-w-5xl mx-auto flex items-start sm:items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-bold text-foreground dark:text-white truncate">
              {org.name}
            </h1>
            <p className="text-xs sm:text-sm text-foreground/80 truncate">{org.community}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {token && (
              <PortalNotificationsPanel
                token={token}
                onOpenSettings={() => onTabChange('settings')}
              />
            )}
            <div
              className="w-8 h-8 rounded-full bg-spoke-soft flex items-center justify-center text-spoke-strong font-semibold text-sm"
              aria-hidden="true"
            >
              {contact.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs sm:text-sm font-medium text-foreground dark:text-muted-foreground hidden sm:inline">
              {contact.name}
            </span>
            <span className="sr-only">Signed in as {contact.name}</span>
          </div>
        </div>
      </header>

      {/* Tab Bar — horizontally scrollable on phones so all four tabs
          stay reachable without cramping. */}
      <nav
        aria-label="Portal sections"
        className="bg-white dark:bg-card border-b border-border px-4 sm:px-6"
      >
        <div className="max-w-5xl mx-auto flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-current={activeTab === tab.id ? 'page' : undefined}
              className={cn(
                'px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1 rounded-t',
                activeTab === tab.id
                  ? 'border-hub text-hub'
                  : 'border-transparent text-foreground/80 hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}

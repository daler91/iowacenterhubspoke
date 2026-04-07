import type { ReactNode } from 'react';
import type { PartnerOrg, PartnerContact } from '../../lib/coordination-types';
import { cn } from '../../lib/utils';

interface Props {
  readonly org: PartnerOrg;
  readonly contact: PartnerContact;
  readonly activeTab: string;
  readonly onTabChange: (tab: string) => void;
  readonly children: ReactNode;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'tasks', label: 'Your Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'messages', label: 'Messages' },
];

export default function PortalLayout({ org, contact, activeTab, onTabChange, children }: Props) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {org.name}
            </h1>
            <p className="text-sm text-slate-500">{org.community}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center text-purple-700 dark:text-purple-300 font-semibold text-sm">
              {contact.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{contact.name}</span>
          </div>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6">
        <div className="max-w-5xl mx-auto flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto p-6">
        {children}
      </main>
    </div>
  );
}

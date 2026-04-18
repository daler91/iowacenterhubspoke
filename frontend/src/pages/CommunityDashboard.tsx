import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { PageShell } from '../components/ui/page-shell';
import {
  GraduationCap, Users, Flame, Handshake, CalendarDays,
} from 'lucide-react';
import { useCommunityDashboard } from '../hooks/useCoordinationData';
import {
  PHASE_LABELS, PHASE_COLORS,
} from '../lib/coordination-types';
import ExportButton from '../components/coordination/ExportButton';
import DashboardTrendChart from '../components/coordination/DashboardTrendChart';
import PartnerHealthTable from '../components/coordination/PartnerHealthTable';
import { cn } from '../lib/utils';

function MetricCard({
  icon: Icon, label, value, alert, color,
}: Readonly<{
  icon: React.ElementType; label: string; value: number | string; alert?: number; color: string;
}>) {
  return (
    <Card className="p-4 flex items-center gap-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', color)}>
        <Icon className="w-5 h-5 text-white" aria-hidden="true" />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">
          {value}
          {alert !== undefined && alert > 0 && (
            <span className="ml-2 text-xs font-medium text-warn bg-warn-soft px-1.5 py-0.5 rounded">
              {alert} overdue
            </span>
          )}
        </p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </Card>
  );
}

export default function CommunityDashboard() {
  const navigate = useNavigate();
  const { dashboard, isLoading } = useCommunityDashboard();

  return (
    <PageShell
      testId="community-dashboard"
      breadcrumbs={[{ label: 'Coordination' }, { label: 'Dashboard' }]}
      title="Coordination Dashboard"
      subtitle="Hub-wide view of class delivery, partner health, and community activity"
      status={isLoading || !dashboard ? { kind: 'loading', variant: 'cards' } : { kind: 'ready' }}
      actions={<ExportButton endpoint="/exports/projects" label="Export" />}
    >
      {dashboard && <>
      {/* Top Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <MetricCard icon={GraduationCap} label="Classes Delivered" value={dashboard.classes_delivered} color="bg-spoke" />
        <MetricCard icon={Users} label="Total Attendance" value={dashboard.total_attendance} color="bg-info" />
        <MetricCard icon={Flame} label="Warm Leads" value={dashboard.warm_leads} color="bg-warn" />
        <MetricCard icon={Handshake} label="Active Partners" value={dashboard.active_partners} color="bg-ownership-partner" />
        <MetricCard
          icon={CalendarDays}
          label="Upcoming Classes"
          value={dashboard.upcoming_classes}
          alert={dashboard.overdue_alert_count}
          color="bg-hub"
        />
      </div>

      {/* Orphan Alert */}
      {dashboard.orphan_completed_schedules > 0 && (
        <Card className="p-4 mb-6 border-warn/30 bg-warn-soft">
          <div className="flex items-center gap-3 text-sm">
            <CalendarDays className="w-5 h-5 text-warn shrink-0" aria-hidden="true" />
            <p className="text-slate-700 dark:text-muted-foreground">
              <strong>{dashboard.orphan_completed_schedules}</strong> completed schedule{dashboard.orphan_completed_schedules > 1 ? 's' : ''} {dashboard.orphan_completed_schedules > 1 ? 'have' : 'has'} no linked project — outcomes are not being tracked.
            </p>
          </div>
        </Card>
      )}

      {/* Class Breakdown */}
      {dashboard.class_breakdown?.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">By Class</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-8">
            {dashboard.class_breakdown.map((cb) => (
              <Card key={cb.class_id || 'unlinked'} className="p-3">
                <div className="flex items-center gap-2 mb-2">
                  {cb.class_color && (
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: cb.class_color }} />
                  )}
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{cb.class_name || 'Unknown'}</p>
                </div>
                <p className="text-lg font-bold text-slate-800 dark:text-white">{cb.delivered}</p>
                <p className="text-[10px] text-muted-foreground">{cb.attendance} attended &middot; {cb.warm_leads} leads</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Community Cards */}
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Communities</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        {dashboard.communities.map(community => (
          // Card wraps a styled <div>; converting to a real <button>
          // would require removing all card styling. Use the
          // role-based alternative with full keyboard support instead.
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
          <Card
            key={community.community}
            role="button"
            tabIndex={0}
            aria-label={`Open board for ${community.community}`}
            className="p-4 cursor-pointer hover:shadow-md transition-shadow focus-visible:ring-2 focus-visible:ring-hub focus-visible:outline-none"
            onClick={() => navigate(`/coordination/board?community=${encodeURIComponent(community.community)}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/coordination/board?community=${encodeURIComponent(community.community)}`);
              }
            }}
          >
            <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-2">{community.community}</h3>
            <div className="flex gap-4 text-sm mb-3">
              <div>
                <span className="text-2xl font-bold text-spoke">{community.delivered}</span>
                <p className="text-[10px] text-muted-foreground">Delivered</p>
              </div>
              <div>
                <span className="text-2xl font-bold text-hub">{community.upcoming}</span>
                <p className="text-[10px] text-muted-foreground">Upcoming</p>
              </div>
            </div>
            {/* Phase bar */}
            {community.phases && Object.keys(community.phases).length > 0 && (
              <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                {Object.entries(community.phases).map(([phase, count]) => (
                  <div
                    key={phase}
                    className={cn(PHASE_COLORS[phase])}
                    style={{ width: `${(count / Math.max(community.upcoming, 1)) * 100}%` }}
                  />
                ))}
              </div>
            )}
            <div className="mt-2 text-xs text-slate-500">
              {community.attendance > 0 && <span>{community.attendance} attended</span>}
              {community.warm_leads > 0 && <span> &middot; {community.warm_leads} leads</span>}
            </div>
          </Card>
        ))}
        {dashboard.communities.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full text-center py-4">
            No community data yet. Create your first project to get started.
          </p>
        )}
      </div>

      {/* Upcoming Classes Table */}
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Upcoming Classes</h2>
      <Card className="overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 dark:bg-gray-900/50 text-left text-slate-500">
                <th className="px-4 py-3 font-medium">Class</th>
                <th className="px-4 py-3 font-medium">Community</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Phase</th>
                <th className="px-4 py-3 font-medium">Registrations</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.upcoming_projects.map(project => (
                // A `<tr>` can't be replaced with a `<button>` without
                // breaking table structure, so the "whole row is
                // clickable" pattern uses the WAI-ARIA alternative:
                // role=button + tabIndex + Enter/Space handling.
                // eslint-disable-next-line jsx-a11y/prefer-tag-over-role
                <tr
                  key={project.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open project ${project.title}`}
                  className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer focus-visible:bg-gray-100 dark:focus-visible:bg-gray-800 focus-visible:outline-none"
                  onClick={() => navigate(`/coordination/projects/${project.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/coordination/projects/${project.id}`);
                    }
                  }}
                >
                  <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{project.title}</td>
                  <td className="px-4 py-3 text-slate-500">{project.community}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(project.event_date).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <Badge className={cn('text-[10px]', PHASE_COLORS[project.phase], 'text-white')}>
                      {PHASE_LABELS[project.phase]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{project.registration_count || 0}</td>
                </tr>
              ))}
              {dashboard.upcoming_projects.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No upcoming classes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Trend Chart */}
      {dashboard.trends && (
        <>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">
            Delivery Trends
          </h2>
          <Card className="p-4 mb-8">
            <DashboardTrendChart trends={dashboard.trends} />
          </Card>
        </>
      )}

      {/* Partner Health */}
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">
        Partner Health
      </h2>
      <div className="mb-8">
        <PartnerHealthTable />
      </div>
      </>}
    </PageShell>
  );
}

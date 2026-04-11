import { lazy, Suspense } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { PageShell } from './ui/page-shell';
import { SkeletonChart } from './ui/skeleton';
import { FileText, BarChart3, TrendingUp, Activity } from 'lucide-react';

const WorkloadDashboard = lazy(() => import('./WorkloadDashboard'));
const WeeklyReport = lazy(() => import('./WeeklyReport'));
const AdvancedAnalytics = lazy(() => import('./AdvancedAnalytics'));
const ActivityFeed = lazy(() => import('./ActivityFeed'));

const TABS = [
  { value: 'summary', label: 'Summary', icon: FileText },
  { value: 'workload', label: 'Workload', icon: BarChart3 },
  { value: 'analytics', label: 'Analytics', icon: TrendingUp },
  { value: 'activity', label: 'Activity', icon: Activity },
] as const;

export default function InsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'summary';
  const context = useOutletContext<Record<string, unknown>>() ?? {};

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  const tabFallback = <SkeletonChart />;

  return (
    <PageShell
      testId="insights-page"
      breadcrumbs={[{ label: 'Insights' }]}
      title="Insights"
      subtitle="Reports, workload analysis, trends, and activity history."
    >
      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="bg-slate-100/80 dark:bg-gray-800/50">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900">
              <Icon className="w-4 h-4 mr-1.5" aria-hidden="true" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary" className="mt-6">
          <Suspense fallback={tabFallback}>
            <WeeklyReport classes={context.classes as unknown[]} />
          </Suspense>
        </TabsContent>

        <TabsContent value="workload" className="mt-6">
          <Suspense fallback={tabFallback}>
            <WorkloadDashboard
              workloadData={context.workloadData as unknown[]}
              classes={context.classes as unknown[]}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <Suspense fallback={tabFallback}>
            <AdvancedAnalytics
              employees={context.employees as unknown[]}
              locations={context.locations as unknown[]}
              classes={context.classes as unknown[]}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <Suspense fallback={tabFallback}>
            <ActivityFeed activities={context.activities as unknown[]} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

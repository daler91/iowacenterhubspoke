import { lazy, Suspense } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
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

  const spinner = (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 animate-slide-in" data-testid="insights-page">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Insights
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Reports, workload analysis, trends, and activity history.
        </p>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="bg-slate-100/80 dark:bg-gray-800/50">
          {TABS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="data-[state=active]:bg-white dark:data-[state=active]:bg-gray-900">
              <Icon className="w-4 h-4 mr-1.5" /> {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary" className="mt-6">
          <Suspense fallback={spinner}>
            <WeeklyReport classes={context.classes as unknown[]} />
          </Suspense>
        </TabsContent>

        <TabsContent value="workload" className="mt-6">
          <Suspense fallback={spinner}>
            <WorkloadDashboard
              workloadData={context.workloadData as unknown[]}
              classes={context.classes as unknown[]}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <Suspense fallback={spinner}>
            <AdvancedAnalytics
              employees={context.employees as unknown[]}
              locations={context.locations as unknown[]}
              classes={context.classes as unknown[]}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <Suspense fallback={spinner}>
            <ActivityFeed activities={context.activities as unknown[]} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}

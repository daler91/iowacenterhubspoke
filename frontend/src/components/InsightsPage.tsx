import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
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

// Radix TabsContent only mounts the active panel, so switching back to a
// heavy tab (Analytics, Workload) pays the full render cost again and
// throws away user-local state like filters and chart zoom. Passing
// `forceMount` keeps the DOM around; we gate it on `visitedTabs` so the
// first paint still only renders the active panel.
type TabValue = typeof TABS[number]['value'];

export default function InsightsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'summary';
  const tab: TabValue = (TABS.find(t => t.value === rawTab)?.value ?? 'summary');
  const context = useOutletContext<Record<string, unknown>>() ?? {};

  const [visitedTabs, setVisitedTabs] = useState<Set<TabValue>>(() => new Set([tab]));
  useEffect(() => {
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [tab]);

  // Measure the duration of user-initiated tab switches so we have a
  // before/after signal for the perf work. Records nothing if the browser
  // lacks the User Timing API (older Safari/JSDOM in tests).
  const pendingSwitch = useRef<string | null>(null);
  const handleTabChange = (value: string) => {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      const mark = `insights-tab-switch:${value}:${Date.now()}`;
      performance.mark(mark);
      pendingSwitch.current = mark;
    }
    setSearchParams({ tab: value }, { replace: true });
  };
  useEffect(() => {
    const start = pendingSwitch.current;
    if (!start) return;
    pendingSwitch.current = null;
    if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return;
    try {
      performance.measure(`insights-tab-switch:${tab}`, start);
    } catch {
      // ignore: the start mark may have been cleared by the browser
    }
  }, [tab]);

  const tabFallback = <SkeletonChart />;

  // Build each panel once per render so the JSX below stays readable.
  const panels = useMemo(() => ({
    summary: <WeeklyReport classes={context.classes as unknown[]} />,
    workload: (
      <WorkloadDashboard
        workloadData={context.workloadData as unknown[]}
        classes={context.classes as unknown[]}
      />
    ),
    analytics: (
      <AdvancedAnalytics
        employees={context.employees as unknown[]}
        locations={context.locations as unknown[]}
        classes={context.classes as unknown[]}
      />
    ),
    activity: <ActivityFeed activities={context.activities as unknown[]} />,
  }), [context.classes, context.workloadData, context.employees, context.locations, context.activities]);

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

        {TABS.map(({ value }) => {
          // Always render the currently-active tab, even if visitedTabs
          // hasn't caught up yet — state from the tab-change effect lags
          // by one commit and would otherwise leave the panel area blank
          // on the very first switch.
          const shouldRender = value === tab || visitedTabs.has(value);
          if (!shouldRender) return null;
          return (
            <TabsContent
              key={value}
              value={value}
              forceMount
              className="mt-6 data-[state=inactive]:hidden"
            >
              <Suspense fallback={tabFallback}>
                {panels[value]}
              </Suspense>
            </TabsContent>
          );
        })}
      </Tabs>
    </PageShell>
  );
}

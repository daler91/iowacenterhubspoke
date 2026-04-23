import { useOutletContext } from 'react-router-dom';
import { TrendingUp, Zap, Car } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import TrendsTab from './analytics/TrendsTab';
import ForecastTab from './analytics/ForecastTab';
import DriveOptimizationTab from './analytics/DriveOptimizationTab';
import type { AnalyticsOutletContext } from '../lib/types';

interface AdvancedAnalyticsProps {
  employees?: unknown[];
  locations?: unknown[];
  classes?: unknown[];
}

export default function AdvancedAnalytics(props: Readonly<AdvancedAnalyticsProps>) {
  const outlet = useOutletContext<AnalyticsOutletContext>() ?? {};
  const employees = props.employees ?? outlet.employees;
  const locations = props.locations ?? outlet.locations;
  const classes = props.classes ?? outlet.classes;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="advanced-analytics">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Advanced Analytics
        </h2>
        <p className="text-sm text-foreground/80 dark:text-muted-foreground mt-1">
          Historical trends, utilization forecasting, and drive time optimization.
        </p>
      </div>

      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="bg-muted/80 dark:bg-muted/50">
          <TabsTrigger value="trends" className="data-[state=active]:bg-card dark:data-[state=active]:bg-card">
            <TrendingUp className="w-4 h-4 mr-1.5" /> Trends
          </TabsTrigger>
          <TabsTrigger value="forecast" className="data-[state=active]:bg-card dark:data-[state=active]:bg-card">
            <Zap className="w-4 h-4 mr-1.5" /> Forecast
          </TabsTrigger>
          <TabsTrigger value="drive" className="data-[state=active]:bg-card dark:data-[state=active]:bg-card">
            <Car className="w-4 h-4 mr-1.5" /> Drive Optimization
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trends" className="mt-6">
          <TrendsTab employees={employees} locations={locations} classes={classes} />
        </TabsContent>

        <TabsContent value="forecast" className="mt-6">
          <ForecastTab employees={employees} classes={classes} />
        </TabsContent>

        <TabsContent value="drive" className="mt-6">
          <DriveOptimizationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

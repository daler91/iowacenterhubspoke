import { useOutletContext } from 'react-router-dom';
import { TrendingUp, Zap, Car } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import TrendsTab from './analytics/TrendsTab';
import ForecastTab from './analytics/ForecastTab';
import DriveOptimizationTab from './analytics/DriveOptimizationTab';

export default function AdvancedAnalytics() {
  const { employees, locations, classes } = useOutletContext<any>();

  return (
    <div className="space-y-6 animate-slide-in" data-testid="advanced-analytics">
      <div>
        <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Advanced Analytics
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          Historical trends, utilization forecasting, and drive time optimization.
        </p>
      </div>

      <Tabs defaultValue="trends" className="w-full">
        <TabsList className="bg-slate-100/80">
          <TabsTrigger value="trends" className="data-[state=active]:bg-white">
            <TrendingUp className="w-4 h-4 mr-1.5" /> Trends
          </TabsTrigger>
          <TabsTrigger value="forecast" className="data-[state=active]:bg-white">
            <Zap className="w-4 h-4 mr-1.5" /> Forecast
          </TabsTrigger>
          <TabsTrigger value="drive" className="data-[state=active]:bg-white">
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

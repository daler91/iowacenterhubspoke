import { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Clock, Car, BookOpen } from 'lucide-react';
import { Badge } from '../ui/badge';
import { analyticsAPI } from '../../lib/api';
import { SummaryCard, FilterSelect, LoadingChart, EmptyState, fetcher } from './shared';
import type { Employee, ClassType, ForecastDataPoint } from '../../lib/types';

interface ForecastTabProps {
  employees: Employee[];
  classes: ClassType[];
}

export default function ForecastTab({ employees, classes }: Readonly<ForecastTabProps>) {
  const [weeksAhead, setWeeksAhead] = useState('8');
  const [employeeId, setEmployeeId] = useState('all');
  const [classId, setClassId] = useState('all');

  const params = useMemo(() => ({
    weeks_ahead: Number.parseInt(weeksAhead),
    ...(employeeId !== 'all' && { employee_id: employeeId }),
    ...(classId !== 'all' && { class_id: classId }),
  }), [weeksAhead, employeeId, classId]);

  const { data, isLoading } = useSWR(
    ['analytics-forecast', params],
    () => fetcher(analyticsAPI.forecast, params),
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      keepPreviousData: true,
      dedupingInterval: 30000,
    }
  );

  const historical = data?.historical || [];
  const forecast = data?.forecast || [];
  const method = data?.method || '';
  const combined = useMemo(() => [...historical, ...forecast], [historical, forecast]);

  const projectedSummary = useMemo(() => {
    if (!forecast.length) return { classes: 0, classHours: 0, driveHours: 0 };
    const next4 = forecast.slice(0, 4);
    return {
      classes: next4.reduce((s: number, f: ForecastDataPoint) => s + f.classes, 0).toFixed(0),
      classHours: next4.reduce((s: number, f: ForecastDataPoint) => s + f.class_hours, 0).toFixed(1),
      driveHours: next4.reduce((s: number, f: ForecastDataPoint) => s + f.drive_hours, 0).toFixed(1),
    };
  }, [forecast]);

  const growthRate = useMemo(() => {
    if (historical.length < 2 || !forecast.length) return null;
    const lastHist = historical[historical.length - 1].classes;
    const lastFore = forecast[forecast.length - 1].classes;
    if (lastHist === 0) return null;
    return (((lastFore - lastHist) / lastHist) * 100).toFixed(0);
  }, [historical, forecast]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <FilterSelect label="Forecast" value={weeksAhead} onChange={setWeeksAhead} options={[
          { value: '4', label: '4 weeks' }, { value: '8', label: '8 weeks' }, { value: '12', label: '12 weeks' },
        ]} />
        <FilterSelect label="Employee" value={employeeId} onChange={setEmployeeId} options={[
          { value: 'all', label: 'All Employees' },
          ...(employees || []).map((e: Employee) => ({ value: e.id, label: e.name })),
        ]} />
        <FilterSelect label="Class" value={classId} onChange={setClassId} options={[
          { value: 'all', label: 'All Classes' },
          ...(classes || []).map((c: ClassType) => ({ value: c.id, label: c.name })),
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={BookOpen} iconBg="bg-hub-soft" iconColor="text-hub"
          label="Projected Classes (4wk)" value={projectedSummary.classes} />
        <SummaryCard icon={Clock} iconBg="bg-spoke-soft" iconColor="text-spoke"
          label="Projected Class Hours" value={`${projectedSummary.classHours}h`} />
        <SummaryCard icon={Car} iconBg="bg-warn-soft" iconColor="text-warn"
          label="Projected Drive Hours" value={`${projectedSummary.driveHours}h`} />
        {growthRate !== null && (
          <SummaryCard
            icon={Number(growthRate) >= 0 ? TrendingUp : TrendingDown}
            iconBg={Number(growthRate) >= 0 ? 'bg-spoke-soft' : 'bg-danger-soft'}
            iconColor={Number(growthRate) >= 0 ? 'text-spoke' : 'text-danger'}
            label="Growth Rate" value={`${growthRate}%`} />
        )}
      </div>

      <div className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">
            Historical & Forecast
          </h3>
          {method === 'linear_regression' && (
            <Badge className="bg-hub-soft text-hub-strong border-0 text-[10px]">Linear Regression</Badge>
          )}
          {method === 'insufficient_data' && (
            <Badge className="bg-warn-soft text-warn border-0 text-[10px]">Insufficient Data</Badge>
          )}
        </div>
        {isLoading && <LoadingChart />}
        {!isLoading && combined.length > 0 && (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={combined}>
              <defs>
                <linearGradient id="classGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="driveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#D97706" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#D97706" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                labelFormatter={(label: string, payload: Array<{ payload?: ForecastDataPoint }>) => {
                  const isForecast = payload?.[0]?.payload?.is_forecast;
                  return `${label}${isForecast ? ' (Forecast)' : ''}`;
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              <Area type="monotone" dataKey="classes" stroke="#4F46E5" fill="url(#classGrad)" strokeWidth={2}
                strokeDasharray="0" name="Classes" />
              <Area type="monotone" dataKey="class_hours" stroke="#0D9488" fill="transparent" strokeWidth={2} name="Class Hours" />
              <Area type="monotone" dataKey="drive_hours" stroke="#D97706" fill="url(#driveGrad)" strokeWidth={2} name="Drive Hours" />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {!isLoading && combined.length === 0 && <EmptyState message="Not enough data to generate forecast. Need at least 2 weeks of history." />}
        {forecast.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3">
            Forecast based on linear trend from last 12 weeks of historical data. Dashed area indicates projected values.
          </p>
        )}
      </div>
    </div>
  );
}

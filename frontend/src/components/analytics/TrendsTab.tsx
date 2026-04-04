import { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Clock, BookOpen, Zap } from 'lucide-react';
import { analyticsAPI } from '../../lib/api';
import { SummaryCard, FilterSelect, LoadingChart, EmptyState, fetcher } from './shared';
import type { Employee, Location, ClassType, TrendDataPoint } from '../../lib/types';

interface TrendsTabProps {
  employees: Employee[];
  locations: Location[];
  classes: ClassType[];
}

export default function TrendsTab({ employees, locations, classes }: TrendsTabProps) {
  const [period, setPeriod] = useState('weekly');
  const [weeksBack, setWeeksBack] = useState('12');
  const [employeeId, setEmployeeId] = useState('all');
  const [locationId, setLocationId] = useState('all');
  const [classId, setClassId] = useState('all');

  const params = useMemo(() => ({
    period,
    weeks_back: Number.parseInt(weeksBack),
    ...(employeeId !== 'all' && { employee_id: employeeId }),
    ...(locationId !== 'all' && { location_id: locationId }),
    ...(classId !== 'all' && { class_id: classId }),
  }), [period, weeksBack, employeeId, locationId, classId]);

  const { data, isLoading } = useSWR(
    ['analytics-trends', params],
    () => fetcher(analyticsAPI.trends, params),
    { revalidateOnFocus: false }
  );

  const trends = data?.data || [];

  const summary = useMemo(() => {
    if (!trends.length) return { avgClasses: 0, totalHours: 0, trend: 'flat', busiest: 'N/A' };
    const avgClasses = (trends.reduce((s: number, t: TrendDataPoint) => s + t.classes, 0) / trends.length).toFixed(1);
    const totalHours = trends.reduce((s: number, t: TrendDataPoint) => s + t.class_hours, 0).toFixed(1);
    const busiest = trends.reduce((best: TrendDataPoint, t: TrendDataPoint) => t.classes > best.classes ? t : best, trends[0]);

    const mid = Math.floor(trends.length / 2);
    const firstHalf = trends.slice(0, mid).reduce((s: number, t: TrendDataPoint) => s + t.classes, 0) / (mid || 1);
    const secondHalf = trends.slice(mid).reduce((s: number, t: TrendDataPoint) => s + t.classes, 0) / (trends.length - mid || 1);
    let trend = 'flat';
    if (secondHalf > firstHalf * 1.05) trend = 'up';
    else if (secondHalf < firstHalf * 0.95) trend = 'down';

    return { avgClasses, totalHours, trend, busiest: busiest.period };
  }, [trends]);

  const trendConfig: Record<string, { icon: typeof TrendingUp; bg: string; color: string; label: string }> = {
    up: { icon: TrendingUp, bg: 'bg-green-50', color: 'text-green-600', label: 'Growing' },
    down: { icon: TrendingDown, bg: 'bg-red-50', color: 'text-red-600', label: 'Declining' },
    flat: { icon: TrendingUp, bg: 'bg-slate-50', color: 'text-slate-600', label: 'Stable' },
  };
  const currentTrend = trendConfig[summary.trend] || trendConfig.flat;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <FilterSelect label="Period" value={period} onChange={setPeriod} options={[
          { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' },
        ]} />
        <FilterSelect label="Range" value={weeksBack} onChange={setWeeksBack} options={[
          { value: '8', label: '8 weeks' }, { value: '12', label: '12 weeks' }, { value: '24', label: '24 weeks' },
        ]} />
        <FilterSelect label="Employee" value={employeeId} onChange={setEmployeeId} options={[
          { value: 'all', label: 'All Employees' },
          ...(employees || []).map((e: Employee) => ({ value: e.id, label: e.name })),
        ]} />
        <FilterSelect label="Location" value={locationId} onChange={setLocationId} options={[
          { value: 'all', label: 'All Locations' },
          ...(locations || []).map((l: Location) => ({ value: l.id, label: l.city_name })),
        ]} />
        <FilterSelect label="Class" value={classId} onChange={setClassId} options={[
          { value: 'all', label: 'All Classes' },
          ...(classes || []).map((c: ClassType) => ({ value: c.id, label: c.name })),
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={BookOpen} iconBg="bg-indigo-50" iconColor="text-indigo-600"
          label="Avg Classes / Period" value={summary.avgClasses} />
        <SummaryCard icon={Clock} iconBg="bg-teal-50" iconColor="text-teal-600"
          label="Total Class Hours" value={`${summary.totalHours}h`} />
        <SummaryCard icon={currentTrend.icon}
          iconBg={currentTrend.bg}
          iconColor={currentTrend.color}
          label="Trend" value={currentTrend.label} />
        <SummaryCard icon={Zap} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Busiest Period" value={summary.busiest} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Trends Over Time
        </h3>
        {isLoading && <LoadingChart />}
        {!isLoading && trends.length > 0 && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="period" tick={{ fontSize: 11, fill: '#64748b' }} angle={-30} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
              <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              <Line type="monotone" dataKey="classes" stroke="#4F46E5" strokeWidth={2} dot={{ r: 3 }} name="Classes" />
              <Line type="monotone" dataKey="class_hours" stroke="#0D9488" strokeWidth={2} dot={{ r: 3 }} name="Class Hours" />
              <Line type="monotone" dataKey="drive_hours" stroke="#D97706" strokeWidth={2} dot={{ r: 3 }} name="Drive Hours" />
            </LineChart>
          </ResponsiveContainer>
        )}
        {!isLoading && trends.length === 0 && <EmptyState message="No trend data available for the selected filters." />}
      </div>
    </div>
  );
}

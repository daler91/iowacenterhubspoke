import { useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import useSWR from 'swr';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, TrendingDown, Clock, Car, BookOpen, ArrowRightLeft, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Label } from './ui/label';
import { analyticsAPI } from '../lib/api';

const fetcher = (url, params) => url(params).then(r => r.data);

// ─── Historical Trends Tab ────────────────────────────────────────────────────

function TrendsTab({ employees, locations, classes }) {
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
    const avgClasses = (trends.reduce((s, t) => s + t.classes, 0) / trends.length).toFixed(1);
    const totalHours = trends.reduce((s, t) => s + t.class_hours, 0).toFixed(1);
    const busiest = trends.reduce((best, t) => t.classes > best.classes ? t : best, trends[0]);

    // Trend direction: compare first half avg to second half avg
    const mid = Math.floor(trends.length / 2);
    const firstHalf = trends.slice(0, mid).reduce((s, t) => s + t.classes, 0) / (mid || 1);
    const secondHalf = trends.slice(mid).reduce((s, t) => s + t.classes, 0) / (trends.length - mid || 1);
    let trend = 'flat';
    if (secondHalf > firstHalf * 1.05) trend = 'up';
    else if (secondHalf < firstHalf * 0.95) trend = 'down';

    return { avgClasses, totalHours, trend, busiest: busiest.period };
  }, [trends]);

  const trendConfig = {
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
          ...(employees || []).map(e => ({ value: e.id, label: e.name })),
        ]} />
        <FilterSelect label="Location" value={locationId} onChange={setLocationId} options={[
          { value: 'all', label: 'All Locations' },
          ...(locations || []).map(l => ({ value: l.id, label: l.city_name })),
        ]} />
        <FilterSelect label="Class" value={classId} onChange={setClassId} options={[
          { value: 'all', label: 'All Classes' },
          ...(classes || []).map(c => ({ value: c.id, label: c.name })),
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

// ─── Utilization Forecast Tab ─────────────────────────────────────────────────

function ForecastTab({ employees, classes }) {
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
    { revalidateOnFocus: false }
  );

  const historical = data?.historical || [];
  const forecast = data?.forecast || [];
  const method = data?.method || '';
  const combined = useMemo(() => [...historical, ...forecast], [historical, forecast]);

  const projectedSummary = useMemo(() => {
    if (!forecast.length) return { classes: 0, classHours: 0, driveHours: 0 };
    const next4 = forecast.slice(0, 4);
    return {
      classes: next4.reduce((s, f) => s + f.classes, 0).toFixed(0),
      classHours: next4.reduce((s, f) => s + f.class_hours, 0).toFixed(1),
      driveHours: next4.reduce((s, f) => s + f.drive_hours, 0).toFixed(1),
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
          ...(employees || []).map(e => ({ value: e.id, label: e.name })),
        ]} />
        <FilterSelect label="Class" value={classId} onChange={setClassId} options={[
          { value: 'all', label: 'All Classes' },
          ...(classes || []).map(c => ({ value: c.id, label: c.name })),
        ]} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={BookOpen} iconBg="bg-indigo-50" iconColor="text-indigo-600"
          label="Projected Classes (4wk)" value={projectedSummary.classes} />
        <SummaryCard icon={Clock} iconBg="bg-teal-50" iconColor="text-teal-600"
          label="Projected Class Hours" value={`${projectedSummary.classHours}h`} />
        <SummaryCard icon={Car} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Projected Drive Hours" value={`${projectedSummary.driveHours}h`} />
        {growthRate !== null && (
          <SummaryCard
            icon={Number(growthRate) >= 0 ? TrendingUp : TrendingDown}
            iconBg={Number(growthRate) >= 0 ? 'bg-green-50' : 'bg-red-50'}
            iconColor={Number(growthRate) >= 0 ? 'text-green-600' : 'text-red-600'}
            label="Growth Rate" value={`${growthRate}%`} />
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Historical & Forecast
          </h3>
          {method === 'linear_regression' && (
            <Badge className="bg-indigo-50 text-indigo-700 border-0 text-[10px]">Linear Regression</Badge>
          )}
          {method === 'insufficient_data' && (
            <Badge className="bg-amber-50 text-amber-700 border-0 text-[10px]">Insufficient Data</Badge>
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
                labelFormatter={(label, payload) => {
                  const isForecast = payload?.[0]?.payload?.is_forecast;
                  return `${label}${isForecast ? ' (Forecast)' : ''}`;
                }}
              />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              <Area type="monotone" dataKey="classes" stroke="#4F46E5" fill="url(#classGrad)" strokeWidth={2}
                strokeDasharray={(d) => d?.is_forecast ? '5 5' : '0'} name="Classes" />
              <Area type="monotone" dataKey="class_hours" stroke="#0D9488" fill="transparent" strokeWidth={2} name="Class Hours" />
              <Area type="monotone" dataKey="drive_hours" stroke="#D97706" fill="url(#driveGrad)" strokeWidth={2} name="Drive Hours" />
            </AreaChart>
          </ResponsiveContainer>
        )}
        {!isLoading && combined.length === 0 && <EmptyState message="Not enough data to generate forecast. Need at least 2 weeks of history." />}
        {forecast.length > 0 && (
          <p className="text-xs text-slate-400 mt-3">
            Forecast based on linear trend from last 12 weeks of historical data. Dashed area indicates projected values.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Drive Time Optimization Tab ──────────────────────────────────────────────

function DriveOptimizationTab() {
  const today = new Date().toISOString().slice(0, 10);
  const fourWeeks = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(fourWeeks);

  const params = useMemo(() => ({ date_from: dateFrom, date_to: dateTo }), [dateFrom, dateTo]);

  const { data, isLoading } = useSWR(
    ['analytics-drive-opt', params],
    () => fetcher(analyticsAPI.driveOptimization, params),
    { revalidateOnFocus: false }
  );

  const summary = data?.summary || {};
  const employeeDrive = data?.employee_drive || [];
  const suggestions = data?.suggestions || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">From</Label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background" />
        </div>
        <div className="space-y-2">
          <Label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">To</Label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={Car} iconBg="bg-amber-50" iconColor="text-amber-600"
          label="Total Drive Hours" value={`${summary.total_drive_hours || 0}h`} />
        <SummaryCard icon={Clock} iconBg="bg-teal-50" iconColor="text-teal-600"
          label="Avg / Schedule" value={`${summary.avg_per_schedule || 0}h`} />
        <SummaryCard icon={TrendingUp} iconBg="bg-indigo-50" iconColor="text-indigo-600"
          label="Highest Driver" value={summary.highest_driver || 'N/A'} />
        <SummaryCard icon={Zap} iconBg="bg-green-50" iconColor="text-green-600"
          label="Potential Savings" value={`${summary.potential_savings_hours || 0}h`} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Drive Hours by Employee
        </h3>
        {isLoading && <LoadingChart />}
        {!isLoading && employeeDrive.length > 0 && (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={employeeDrive} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
              <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
              <Bar dataKey="drive_hours" fill="#D97706" radius={[4, 4, 0, 0]} name="Drive Hours" />
            </BarChart>
          </ResponsiveContainer>
        )}
        {!isLoading && employeeDrive.length === 0 && <EmptyState message="No drive data for the selected period." />}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Optimization Suggestions
        </h3>
        {suggestions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Swap</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Locations</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Savings</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-400 uppercase tracking-wider">Reason</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  let savingsBadgeClass = 'bg-slate-50 text-slate-600';
                  if (s.savings_mins >= 120) savingsBadgeClass = 'bg-green-50 text-green-700';
                  else if (s.savings_mins >= 60) savingsBadgeClass = 'bg-amber-50 text-amber-700';

                  return (
                  <tr key={`${s.date}-${s.schedule_a_id}-${s.schedule_b_id}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2.5 px-3 text-slate-700">{s.date}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <span className="font-medium">{s.employee_a.split(' ')[0]}</span>
                        <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-medium">{s.employee_b.split(' ')[0]}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 text-xs">
                      {s.location_a} / {s.location_b}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Badge className={`border-0 text-[10px] ${savingsBadgeClass}`}>
                        {s.savings_mins}m saved
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-500">{s.reason}</td>
                  </tr>);
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No optimization suggestions found. Schedules are already well-distributed, or insufficient overlapping assignments." />
        )}
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, iconBg, iconColor, label, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 ${iconBg} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-xs text-slate-400 uppercase font-medium tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
        {value}
      </p>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="min-w-[160px] space-y-2">
      <Label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function LoadingChart() {
  return (
    <div className="h-[320px] flex items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">Loading analytics...</p>
      </div>
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
      {message}
    </div>
  );
}


// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdvancedAnalytics() {
  const { employees, locations, classes } = useOutletContext();

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

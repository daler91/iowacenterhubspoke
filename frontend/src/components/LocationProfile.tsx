import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Car, MapPin, Users, Filter,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const RADIAN = Math.PI / 180;
const renderOuterLabel = ({ cx, cy, midAngle, outerRadius, name, percent }) => {
  const radius = outerRadius + 20;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#475569" fontSize={11} textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
      {name} ({(percent * 100).toFixed(0)}%)
    </text>
  );
};
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { EntityLink } from './ui/entity-link';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { PageShell } from './ui/page-shell';
import { ScheduleStatsGrid } from './ui/schedule-stats-grid';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';
import { getScheduleStatusStyle } from '../lib/schedule-status';

const PIE_COLORS = ['#4F46E5', '#0D9488', '#F97316', '#DC2626', '#7C3AED', '#2563EB', '#059669', '#D97706'];

export default function LocationProfile({ locationId: propId, onBack: propOnBack } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const locationId = propId || params.id;
  const onBack = propOnBack || (() => navigate('/locations'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    if (!locationId) return undefined;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const params = {};
    if (dateFrom) params.start_date = dateFrom;
    if (dateTo) params.end_date = dateTo;
    api.get(`/locations/${locationId}/stats`, { params, signal: controller.signal })
      .then(res => { if (!controller.signal.aborted) setData(res.data); })
      .catch(err => {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return;
        setData(null);
        setError(err instanceof Error ? err : new Error('Failed to load location profile.'));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    // Cancel the in-flight request when filters change rapidly so a slow
    // earlier response can't overwrite a faster newer one.
    return () => controller.abort();
  }, [locationId, dateFrom, dateTo]);

  const isEmbedded = !!propOnBack;
  const breadcrumbs = isEmbedded ? undefined : [
    { label: 'Manage' },
    { label: 'Locations', path: '/locations' },
    { label: data?.location?.city_name || 'Location' },
  ];
  const actions = isEmbedded ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      data-testid="location-profile-back-btn"
      className="text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 -ml-2"
    >
      <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
      Back to Locations
    </Button>
  ) : undefined;

  // While loading the initial page (no data yet), PageShell skeletonizes.
  // When refetching with a filter change (loading && data exists), keep the
  // current data visible and just show a small inline spinner.
  let status;
  if (loading && !data) status = { kind: 'loading', variant: 'cards' };
  else if (error && !data) status = { kind: 'error', error };
  else status = { kind: 'ready' };

  const location = data?.location;
  const hasDateFilter = dateFrom || dateTo;

  return (
    <PageShell
      testId="location-profile"
      breadcrumbs={breadcrumbs}
      title={location?.city_name || 'Location'}
      actions={actions}
      status={status}
    >
      {data && location && (
        <>
          {/* Profile header */}
          <Card className="p-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-spoke-soft flex items-center justify-center shrink-0">
                <MapPin className="w-8 h-8 text-spoke" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1 mt-1">
                  <Car className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm text-slate-500 dark:text-gray-400">{location.drive_time_minutes} min from Hub</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Date filter */}
          <Card className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-slate-500 dark:text-gray-400">
                <Filter className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">Date Range</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap flex-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="location-date-from" className="text-xs text-slate-500 dark:text-gray-400 whitespace-nowrap">From</Label>
                  <Input
                    id="location-date-from"
                    type="date"
                    data-testid="location-profile-date-from"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-40 h-8 text-sm bg-gray-50/50 dark:bg-gray-800/50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="location-date-to" className="text-xs text-slate-500 dark:text-gray-400 whitespace-nowrap">To</Label>
                  <Input
                    id="location-date-to"
                    type="date"
                    data-testid="location-profile-date-to"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-40 h-8 text-sm bg-gray-50/50 dark:bg-gray-800/50"
                  />
                </div>
                {hasDateFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="location-profile-clear-dates"
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                    className="text-xs text-muted-foreground hover:text-slate-600"
                  >
                    Clear
                  </Button>
                )}
              </div>
              {loading && (
                <output aria-label="Refreshing">
                  <span className="block w-4 h-4 border-2 border-hub border-t-transparent rounded-full animate-spin" />
                </output>
              )}
            </div>
          </Card>

          {/* Stats grid */}
          <ScheduleStatsGrid
            totalLabel="Total Schedules"
            totalTestId="profile-total-schedules"
            data={{
              total: data.total_schedules,
              total_class_minutes: data.total_class_minutes,
              total_drive_minutes: data.total_drive_minutes,
              completed: data.completed,
              upcoming: data.upcoming,
            }}
          />

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employee breakdown */}
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-gray-100 mb-4 font-display">
                Employees at this Location
              </h2>
              {data.employee_breakdown?.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.employee_breakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={90} />
                    <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                    <Bar dataKey="count" fill="#0D9488" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                  No employee data yet
                </div>
              )}
            </Card>

            {/* Class breakdown */}
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-gray-100 mb-4 font-display">
                Classes Taught
              </h2>
              {data.class_breakdown?.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={data.class_breakdown.filter(c => c.name)} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={renderOuterLabel} labelLine={{ stroke: '#94a3b8', strokeWidth: 1 }}>
                      {data.class_breakdown.filter(c => c.name).map((entry, index) => (
                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">
                  No class data yet
                </div>
              )}
            </Card>
          </div>

          {/* Recent schedules */}
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-gray-100 mb-4 font-display">
              Recent Assignments
            </h2>
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-3">
                {(data.recent_schedules || []).map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50/50 dark:bg-gray-800/50 rounded-lg" data-testid={`recent-schedule-${s.id}`}>
                    <div className="w-8 h-8 rounded-lg bg-hub-soft flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-hub" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {s.employees?.length > 0 ? (
                        s.employees.map((emp, i) => (
                          <span key={emp.id}>
                            <EntityLink type="employee" id={emp.id} className="text-sm font-medium text-slate-700 dark:text-gray-200">{emp.name}</EntityLink>
                            {i < s.employees.length - 1 && ', '}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm font-medium text-slate-700 dark:text-gray-200">Unassigned</span>
                      )}
                      <p className="text-xs text-muted-foreground">{s.class_name} | {s.date} | {s.start_time}-{s.end_time}</p>
                    </div>
                    <Badge className={`border-0 text-[10px] ${getScheduleStatusStyle(s.status)}`}>
                      {(s.status || 'upcoming').replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
                {(!data.recent_schedules || data.recent_schedules.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-8">No assignments yet</p>
                )}
              </div>
            </ScrollArea>
          </Card>
        </>
      )}
    </PageShell>
  );
}

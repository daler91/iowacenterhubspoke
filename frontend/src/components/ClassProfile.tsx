import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Users, Filter, GraduationCap, Flame,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
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

export default function ClassProfile({ classId: propId, onBack: propOnBack } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const classId = propId || params.id;
  const onBack = propOnBack || (() => navigate('/classes'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchStats = useCallback(() => {
    if (!classId) return;
    setLoading(true);
    setError(null);
    const params = {};
    if (dateFrom) params.start_date = dateFrom;
    if (dateTo) params.end_date = dateTo;
    api.get(`/classes/${classId}/stats`, { params })
      .then(res => setData(res.data))
      .catch(err => { setData(null); setError(err instanceof Error ? err : new Error('Failed to load class profile.')); })
      .finally(() => setLoading(false));
  }, [classId, dateFrom, dateTo]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const isEmbedded = !!propOnBack;
  const breadcrumbs = isEmbedded ? undefined : [
    { label: 'Manage' },
    { label: 'Classes', path: '/classes' },
    { label: data?.class_info?.name || 'Class' },
  ];
  const actions = isEmbedded ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      data-testid="class-profile-back-btn"
      className="text-slate-500 hover:text-slate-700 -ml-2"
    >
      <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
      Back to Classes
    </Button>
  ) : undefined;

  let status;
  if (loading && !data) status = { kind: 'loading', variant: 'cards' };
  else if (error && !data) status = { kind: 'error', error };
  else status = { kind: 'ready' };

  const class_info = data?.class_info;
  const hasDateFilter = dateFrom || dateTo;

  return (
    <PageShell
      testId="class-profile"
      breadcrumbs={breadcrumbs}
      title={class_info?.name || 'Class'}
      subtitle={class_info?.description || undefined}
      actions={actions}
      status={status}
    >
      {data && class_info && (
        <>
          {/* Profile header (color swatch) */}
          <Card className="p-6">
            <div className="flex items-center gap-5">
              <div
                className="w-16 h-16 rounded-2xl shrink-0"
                style={{ backgroundColor: class_info.color || '#0F766E' }}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm text-slate-500">Class color and summary</p>
              </div>
            </div>
          </Card>

          {/* Date filter */}
          <Card className="p-4">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 text-slate-500">
                <Filter className="w-4 h-4" aria-hidden="true" />
                <span className="text-sm font-medium">Date Range</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap flex-1">
                <div className="flex items-center gap-2">
                  <Label htmlFor="class-date-from" className="text-xs text-slate-500 whitespace-nowrap">From</Label>
                  <Input
                    id="class-date-from"
                    type="date"
                    data-testid="class-profile-date-from"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-40 h-8 text-sm bg-gray-50/50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="class-date-to" className="text-xs text-slate-500 whitespace-nowrap">To</Label>
                  <Input
                    id="class-date-to"
                    type="date"
                    data-testid="class-profile-date-to"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-40 h-8 text-sm bg-gray-50/50"
                  />
                </div>
                {hasDateFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="class-profile-clear-dates"
                    onClick={() => { setDateFrom(''); setDateTo(''); }}
                    className="text-xs text-slate-400 hover:text-slate-600"
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

          {/* Business Outcomes (from linked projects) */}
          {(data.projects_delivered > 0 || data.total_attendance > 0) && (
            <div className="grid grid-cols-3 gap-4">
              <Card className="p-4 text-center border-spoke/20">
                <GraduationCap className="w-5 h-5 text-spoke mx-auto mb-2" aria-hidden="true" />
                <p className="text-2xl font-bold text-slate-800 font-display">
                  {data.projects_delivered}
                </p>
                <p className="text-xs text-slate-500">Projects Delivered</p>
              </Card>
              <Card className="p-4 text-center border-spoke/20">
                <Users className="w-5 h-5 text-spoke mx-auto mb-2" aria-hidden="true" />
                <p className="text-2xl font-bold text-slate-800 font-display">
                  {data.total_attendance}
                </p>
                <p className="text-xs text-slate-500">Total Attendance</p>
              </Card>
              <Card className="p-4 text-center border-spoke/20">
                <Flame className="w-5 h-5 text-warn mx-auto mb-2" aria-hidden="true" />
                <p className="text-2xl font-bold text-slate-800 font-display">
                  {data.total_warm_leads}
                </p>
                <p className="text-xs text-slate-500">Warm Leads</p>
              </Card>
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Employee breakdown */}
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-4 font-display">
                Employees Teaching
              </h2>
              {data.employee_breakdown?.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.employee_breakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={90} />
                    <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                    <Bar dataKey="count" fill={class_info.color || '#0F766E'} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
                  No employee data yet
                </div>
              )}
            </Card>

            {/* Location breakdown */}
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-4 font-display">
                Locations
              </h2>
              {data.location_breakdown?.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.location_breakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={90} />
                    <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                    <Bar dataKey="count" fill="#0D9488" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
                  No location data yet
                </div>
              )}
            </Card>
          </div>

          {/* Recent schedules */}
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-4 font-display">
              Recent Assignments
            </h2>
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-3">
                {(data.recent_schedules || []).map(s => (
                  <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-lg" data-testid={`recent-schedule-${s.id}`}>
                    <div className="w-8 h-8 rounded-lg bg-hub-soft flex items-center justify-center shrink-0">
                      <Users className="w-4 h-4 text-hub" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {s.employees?.length > 0 ? (
                        s.employees.map((emp, i) => (
                          <span key={emp.id}>
                            <EntityLink type="employee" id={emp.id} className="text-sm font-medium text-slate-700">{emp.name}</EntityLink>
                            {i < s.employees.length - 1 && ', '}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm font-medium text-slate-700">Unassigned</span>
                      )}
                      <p className="text-xs text-slate-400"><EntityLink type="location" id={s.location_id} className="text-slate-400">{s.location_name}</EntityLink> | {s.date} | {s.start_time}-{s.end_time}</p>
                    </div>
                    <Badge className={`border-0 text-[10px] ${getScheduleStatusStyle(s.status)}`}>
                      {(s.status || 'upcoming').replace('_', ' ')}
                    </Badge>
                  </div>
                ))}
                {(!data.recent_schedules || data.recent_schedules.length === 0) && (
                  <p className="text-sm text-slate-400 text-center py-8">No assignments yet</p>
                )}
              </div>
            </ScrollArea>
          </Card>
        </>
      )}
    </PageShell>
  );
}

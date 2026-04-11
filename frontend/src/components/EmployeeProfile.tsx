import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  MapPin, Mail, Phone, ArrowLeft,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { EntityLink } from './ui/entity-link';
import { PageShell } from './ui/page-shell';
import { ScheduleStatsGrid } from './ui/schedule-stats-grid';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';
import { getScheduleStatusStyle } from '../lib/schedule-status';

export default function EmployeeProfile({ employeeId: propId, onBack: propOnBack } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const employeeId = propId || params.id;
  const onBack = propOnBack || (() => navigate('/employees'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!employeeId) return;
    const loadStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/employees/${employeeId}/stats`);
        setData(res.data);
      } catch (err) {
        setData(null);
        setError(err instanceof Error ? err : new Error('Failed to load employee profile.'));
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, [employeeId]);

  // Embedded mode: renders inside EmployeeManager as a quasi-modal. We keep
  // the back button instead of breadcrumbs so the user has an obvious exit.
  // Routed mode (via /employees/:id): PageShell adds breadcrumbs and reuses
  // the shared header/loading/error semantics.
  const isEmbedded = !!propOnBack;
  const breadcrumbs = isEmbedded ? undefined : [
    { label: 'Manage' },
    { label: 'Employees', path: '/employees' },
    { label: data?.employee?.name || 'Employee' },
  ];
  const actions = isEmbedded ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      data-testid="profile-back-btn"
      className="text-slate-500 hover:text-slate-700 -ml-2"
    >
      <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
      Back to Employees
    </Button>
  ) : undefined;

  let status;
  if (loading) status = { kind: 'loading', variant: 'cards' };
  else if (error || !data) status = { kind: 'error', error };
  else status = { kind: 'ready' };

  const employee = data?.employee;

  return (
    <PageShell
      testId="employee-profile"
      breadcrumbs={breadcrumbs}
      title={employee?.name || 'Employee'}
      actions={actions}
      status={status}
    >
      {data && employee && (
        <>
          {/* Profile header */}
          <Card className="p-6">
            <div className="flex items-center gap-5">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shrink-0"
                style={{ backgroundColor: employee.color || '#4F46E5' }}
                aria-hidden="true"
              >
                {employee.name?.charAt(0)?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-4 mt-1 flex-wrap">
                  {employee.email && (
                    <div className="flex items-center gap-1 text-sm text-slate-500">
                      <Mail className="w-4 h-4" aria-hidden="true" />
                      {employee.email}
                    </div>
                  )}
                  {employee.phone && (
                    <div className="flex items-center gap-1 text-sm text-slate-500">
                      <Phone className="w-4 h-4" aria-hidden="true" />
                      {employee.phone}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Stats grid */}
          <ScheduleStatsGrid
            totalLabel="Total Classes"
            totalTestId="profile-total-classes"
            data={{
              total: data.total_classes,
              total_class_minutes: data.total_class_minutes,
              total_drive_minutes: data.total_drive_minutes,
              completed: data.completed,
              upcoming: data.upcoming,
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Location breakdown */}
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-4 font-display">
                Locations Visited
              </h2>
              {data.location_breakdown?.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.location_breakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={90} />
                    <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                    <Bar dataKey="count" fill={employee.color || '#4F46E5'} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
                  No location data yet
                </div>
              )}
            </Card>

            {/* Recent schedules */}
            <Card className="p-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-4 font-display">
                Recent Assignments
              </h2>
              <ScrollArea className="max-h-[250px]">
                <div className="space-y-3">
                  {(data.recent_schedules || []).map(s => (
                    <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-lg" data-testid={`recent-schedule-${s.id}`}>
                      <div className="w-8 h-8 rounded-lg bg-hub-soft flex items-center justify-center shrink-0">
                        <MapPin className="w-4 h-4 text-hub" aria-hidden="true" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <EntityLink type="location" id={s.location_id} className="text-sm font-medium text-slate-700">{s.location_name}</EntityLink>
                        <p className="text-xs text-slate-400">{s.date} | {s.start_time}-{s.end_time}</p>
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
          </div>
        </>
      )}
    </PageShell>
  );
}

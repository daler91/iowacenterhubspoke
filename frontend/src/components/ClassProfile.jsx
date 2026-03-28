import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import PropTypes from 'prop-types';
import {
  ArrowLeft, Clock, Car, BookOpen,
  CheckCircle2, CalendarDays, Users, Filter
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { EntityLink } from './ui/entity-link';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';

export default function ClassProfile({ classId: propId, onBack: propOnBack } = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const classId = propId || params.id;
  const onBack = propOnBack || (() => navigate('/classes'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchStats = useCallback(() => {
    if (!classId) return;
    setLoading(true);
    const params = {};
    if (dateFrom) params.start_date = dateFrom;
    if (dateTo) params.end_date = dateTo;
    api.get(`/classes/${classId}/stats`, { params })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [classId, dateFrom, dateTo]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return (
    <div className="text-center py-12 text-slate-500">
      <p className="text-sm">Failed to load class profile.</p>
      <Button variant="ghost" onClick={onBack} className="mt-2 text-indigo-600">Go back</Button>
    </div>
  );

  const { class_info, total_schedules, total_drive_minutes, total_class_minutes, completed, upcoming, employee_breakdown, location_breakdown, recent_schedules } = data;

  const getStatusStyle = (status) => {
    if (status === 'completed') return 'bg-green-50 text-green-700';
    if (status === 'in_progress') return 'bg-amber-50 text-amber-700';
    return 'bg-indigo-50 text-indigo-700';
  };

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="class-profile">
      {/* Back button */}
      <Button variant="ghost" onClick={onBack} className="text-slate-500 hover:text-slate-700 -ml-2" data-testid="class-profile-back-btn">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Classes
      </Button>

      {/* Profile header */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center gap-5">
          <div
            className="w-16 h-16 rounded-2xl"
            style={{ backgroundColor: class_info.color || '#0F766E' }}
          />
          <div>
            <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {class_info.name}
            </h2>
            {class_info.description && (
              <p className="text-sm text-slate-500 mt-1">{class_info.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-slate-500">
            <Filter className="w-4 h-4" />
            <span className="text-sm font-medium">Date Range</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap flex-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="date-from" className="text-xs text-slate-500 whitespace-nowrap">From</Label>
              <Input
                id="date-from"
                type="date"
                data-testid="class-profile-date-from"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-40 h-8 text-sm bg-gray-50/50"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="date-to" className="text-xs text-slate-500 whitespace-nowrap">To</Label>
              <Input
                id="date-to"
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
            <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <BookOpen className="w-5 h-5 text-indigo-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="profile-total-schedules">
            {total_schedules}
          </p>
          <p className="text-xs text-slate-500">Total Schedules</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <Clock className="w-5 h-5 text-teal-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {(total_class_minutes / 60).toFixed(1)}h
          </p>
          <p className="text-xs text-slate-500">Class Time</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <Car className="w-5 h-5 text-amber-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {(total_drive_minutes / 60).toFixed(1)}h
          </p>
          <p className="text-xs text-slate-500">Drive Time</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {completed}
          </p>
          <p className="text-xs text-slate-500">Completed</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <CalendarDays className="w-5 h-5 text-violet-600 mx-auto mb-2" />
          <p className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {upcoming}
          </p>
          <p className="text-xs text-slate-500">Upcoming</p>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Employee breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Employees Teaching
          </h3>
          {employee_breakdown?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={employee_breakdown} layout="vertical">
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
        </div>

        {/* Location breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Locations
          </h3>
          {location_breakdown?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={location_breakdown} layout="vertical">
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
        </div>
      </div>

      {/* Recent schedules */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Recent Assignments
        </h3>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-3">
            {(recent_schedules || []).map(s => (
              <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-lg" data-testid={`recent-schedule-${s.id}`}>
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Users className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <EntityLink type="employee" id={s.employee_id} className="text-sm font-medium text-slate-700">{s.employee_name}</EntityLink>
                  <p className="text-xs text-slate-400"><EntityLink type="location" id={s.location_id} className="text-slate-400">{s.location_name}</EntityLink> | {s.date} | {s.start_time}-{s.end_time}</p>
                </div>
                <Badge className={`border-0 text-[10px] ${getStatusStyle(s.status)}`}>
                  {(s.status || 'upcoming').replace('_', ' ')}
                </Badge>
              </div>
            ))}
            {(!recent_schedules || recent_schedules.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-8">No assignments yet</p>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

ClassProfile.propTypes = {
  classId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  onBack: PropTypes.func,
};

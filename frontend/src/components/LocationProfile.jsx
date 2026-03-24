import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import {
  ArrowLeft, Clock, Car, MapPin, BookOpen,
  CheckCircle2, CalendarDays, Users
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import api from '../lib/api';

export default function LocationProfile({ locationId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) return;
    setLoading(true);
    api.get(`/locations/${locationId}/stats`)
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [locationId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return (
    <div className="text-center py-12 text-slate-500">
      <p className="text-sm">Failed to load location profile.</p>
      <Button variant="ghost" onClick={onBack} className="mt-2 text-indigo-600">Go back</Button>
    </div>
  );

  const { location, total_schedules, total_drive_minutes, total_class_minutes, completed, upcoming, employee_breakdown, recent_schedules } = data;

  const getStatusStyle = (status) => {
    if (status === 'completed') return 'bg-green-50 text-green-700';
    if (status === 'in_progress') return 'bg-amber-50 text-amber-700';
    return 'bg-indigo-50 text-indigo-700';
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="location-profile">
      {/* Back button */}
      <Button variant="ghost" onClick={onBack} className="text-slate-500 hover:text-slate-700 -ml-2" data-testid="location-profile-back-btn">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Locations
      </Button>

      {/* Profile header */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 flex items-center justify-center">
            <MapPin className="w-8 h-8 text-teal-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
              {location.city_name}
            </h2>
            <div className="flex items-center gap-1 mt-1">
              <Car className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-500">{location.drive_time_minutes} min from Hub</span>
            </div>
          </div>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Employee breakdown */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Employees at this Location
          </h3>
          {employee_breakdown?.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={employee_breakdown} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: '#64748b' }} width={90} />
                <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
                <Bar dataKey="count" fill="#0D9488" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">
              No employee data yet
            </div>
          )}
        </div>

        {/* Recent schedules */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Recent Assignments
          </h3>
          <ScrollArea className="max-h-[250px]">
            <div className="space-y-3">
              {(recent_schedules || []).map(s => (
                <div key={s.id} className="flex items-center gap-3 p-3 bg-gray-50/50 rounded-lg" data-testid={`recent-schedule-${s.id}`}>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                    <Users className="w-4 h-4 text-indigo-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700">{s.employee_name}</p>
                    <p className="text-xs text-slate-400">{s.class_name} | {s.date} | {s.start_time}-{s.end_time}</p>
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
    </div>
  );
}

LocationProfile.propTypes = {
  locationId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onBack: PropTypes.func.isRequired,
};

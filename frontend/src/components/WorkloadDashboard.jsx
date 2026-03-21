import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Clock, Car, BookOpen, TrendingUp } from 'lucide-react';
import { Badge } from './ui/badge';

const COLORS = ['#4F46E5', '#0D9488', '#DC2626', '#EA580C', '#7C3AED', '#2563EB', '#059669', '#D97706'];

export default function WorkloadDashboard({ workloadData, employees }) {
  const chartData = (workloadData || []).map(w => ({
    name: w.employee_name?.split(' ')[0] || '?',
    fullName: w.employee_name,
    'Class Hours': w.total_class_hours,
    'Drive Hours': w.total_drive_hours,
    classes: w.total_classes,
    completed: w.completed,
    upcoming: w.upcoming,
    color: w.employee_color,
  }));

  const totals = (workloadData || []).reduce((acc, w) => ({
    classes: acc.classes + w.total_classes,
    classHours: acc.classHours + w.total_class_hours,
    driveHours: acc.driveHours + w.total_drive_hours,
    completed: acc.completed + w.completed,
  }), { classes: 0, classHours: 0, driveHours: 0, completed: 0 });

  const pieData = (workloadData || []).filter(w => w.total_classes > 0).map(w => ({
    name: w.employee_name,
    value: w.total_classes,
    color: w.employee_color || '#4F46E5',
  }));

  return (
    <div className="space-y-6 animate-slide-in" data-testid="workload-dashboard">
      <div>
        <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
          Workload Overview
        </h2>
        <p className="text-sm text-slate-500 mt-1">Team resource allocation and time distribution</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="text-xs text-slate-400 uppercase font-medium tracking-wider">Total Classes</span>
          </div>
          <p className="text-3xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }} data-testid="workload-total-classes">
            {totals.classes}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-teal-50 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-teal-600" />
            </div>
            <span className="text-xs text-slate-400 uppercase font-medium tracking-wider">Class Hours</span>
          </div>
          <p className="text-3xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {totals.classHours.toFixed(1)}h
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-xs text-slate-400 uppercase font-medium tracking-wider">Drive Hours</span>
          </div>
          <p className="text-3xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {totals.driveHours.toFixed(1)}h
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-xs text-slate-400 uppercase font-medium tracking-wider">Completed</span>
          </div>
          <p className="text-3xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {totals.completed}
          </p>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar chart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Hours by Employee
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }}
                  labelFormatter={(val, payload) => payload?.[0]?.payload?.fullName || val}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="Class Hours" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Drive Hours" fill="#E5E7EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
              No schedule data yet. Create some classes to see workload distribution.
            </div>
          )}
        </div>

        {/* Pie chart */}
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4" style={{ fontFamily: 'Manrope, sans-serif' }}>
            Class Distribution
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-slate-400 text-sm">
              No data yet
            </div>
          )}
          <div className="space-y-2 mt-2">
            {pieData.map((d, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-slate-600 truncate max-w-[120px]">{d.name}</span>
                </div>
                <span className="font-semibold text-slate-800">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Employee cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(workloadData || []).map(w => (
          <div key={w.employee_id} className="bg-white rounded-xl border border-gray-100 p-5 hover:shadow-md transition-shadow" data-testid={`workload-card-${w.employee_id}`}>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: w.employee_color }}
              >
                {w.employee_name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">{w.employee_name}</p>
                <p className="text-xs text-slate-400">{w.total_classes} classes total</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Class Time</span>
                <span className="font-semibold text-slate-700">{w.total_class_hours}h</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full" style={{ width: `${Math.min((w.total_class_hours / Math.max(...(workloadData || []).map(x => x.total_class_hours), 1)) * 100, 100)}%`, backgroundColor: w.employee_color }} />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Drive Time</span>
                <span className="font-semibold text-slate-700">{w.total_drive_hours}h</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full bg-gray-300" style={{ width: `${Math.min((w.total_drive_hours / Math.max(...(workloadData || []).map(x => x.total_drive_hours), 1)) * 100, 100)}%` }} />
              </div>
              <div className="flex gap-2 mt-3">
                <Badge className="bg-green-50 text-green-700 border-0 text-[10px]">{w.completed} done</Badge>
                <Badge className="bg-indigo-50 text-indigo-700 border-0 text-[10px]">{w.upcoming} upcoming</Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

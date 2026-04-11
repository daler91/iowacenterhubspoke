import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Clock, Car, BookOpen, TrendingUp } from 'lucide-react';
import { Badge } from './ui/badge';
import { EntityLink } from './ui/entity-link';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

const ALL_CLASSES_VALUE = 'all';

import { useOutletContext } from 'react-router-dom';

interface WorkloadDashboardProps {
  workloadData?: unknown[];
  classes?: unknown[];
}

export default function WorkloadDashboard(props: Readonly<WorkloadDashboardProps>) {
  const outlet = useOutletContext<Record<string, unknown>>() ?? {};
  const workloadData = props.workloadData ?? outlet.workloadData;
  const classes = props.classes ?? outlet.classes;
  const [selectedClassId, setSelectedClassId] = useState(ALL_CLASSES_VALUE);

  const classOptions = useMemo(() => {
    const map = new Map();

    (classes || []).forEach((classItem) => {
      map.set(classItem.id, {
        class_id: classItem.id,
        class_name: classItem.name,
        class_color: classItem.color || '#0F766E',
        classes: 0,
        class_hours: 0,
        drive_hours: 0,
      });
    });

    (workloadData || []).forEach((employeeWorkload) => {
      (employeeWorkload.class_breakdown || []).forEach((classItem) => {
        const key = classItem.class_id || `archived-${classItem.class_name}`;
        const existing = map.get(key) || {
          class_id: classItem.class_id,
          class_name: classItem.class_name,
          class_color: classItem.class_color || '#94A3B8',
          classes: 0,
          class_hours: 0,
          drive_hours: 0,
        };

        existing.classes += classItem.classes || 0;
        existing.class_hours += classItem.class_hours || 0;
        existing.drive_hours += classItem.drive_hours || 0;
        map.set(key, existing);
      });
    });

    return Array.from(map.values()).sort((a, b) => b.classes - a.classes || a.class_name.localeCompare(b.class_name));
  }, [classes, workloadData]);

  const scopedWorkload = useMemo(() => (
    (workloadData || []).map((employeeWorkload) => {
      if (selectedClassId === ALL_CLASSES_VALUE) {
        return {
          ...employeeWorkload,
          display_classes: employeeWorkload.total_classes,
          display_class_hours: employeeWorkload.total_class_hours,
          display_drive_hours: employeeWorkload.total_drive_hours,
        };
      }

      const matchedClass = (employeeWorkload.class_breakdown || []).find(
        (classItem) => classItem.class_id === selectedClassId,
      );

      return {
        ...employeeWorkload,
        display_classes: matchedClass?.classes || 0,
        display_class_hours: matchedClass?.class_hours || 0,
        display_drive_hours: matchedClass?.drive_hours || 0,
      };
    }).filter((employeeWorkload) => selectedClassId === ALL_CLASSES_VALUE || employeeWorkload.display_classes > 0)
  ), [selectedClassId, workloadData]);

  const chartData = scopedWorkload.map((employeeWorkload) => ({
    name: employeeWorkload.employee_name?.split(' ')[0] || '?',
    fullName: employeeWorkload.employee_name,
    'Class Hours': employeeWorkload.display_class_hours,
    'Drive Hours': employeeWorkload.display_drive_hours,
    classes: employeeWorkload.display_classes,
    completed: employeeWorkload.completed,
    upcoming: employeeWorkload.upcoming,
    color: employeeWorkload.employee_color,
  }));

  const totals = scopedWorkload.reduce((acc, employeeWorkload) => ({
    classes: acc.classes + employeeWorkload.display_classes,
    classHours: acc.classHours + employeeWorkload.display_class_hours,
    driveHours: acc.driveHours + employeeWorkload.display_drive_hours,
    completed: acc.completed + employeeWorkload.completed,
  }), { classes: 0, classHours: 0, driveHours: 0, completed: 0 });

  const pieData = scopedWorkload.filter((employeeWorkload) => employeeWorkload.display_classes > 0).map((employeeWorkload) => ({
    name: employeeWorkload.employee_name,
    employee_id: employeeWorkload.employee_id,
    value: employeeWorkload.display_classes,
    color: employeeWorkload.employee_color || '#4F46E5',
  }));

  return (
    <div className="space-y-6 animate-slide-in" data-testid="workload-dashboard">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h2 className="text-2xl font-bold text-slate-800 font-display">
          Workload Overview
        </h2>
        <div className="min-w-[240px] space-y-2">
          <Label className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground" htmlFor="workload-class-filter">
            Filter by Class
          </Label>
          <Select value={selectedClassId} onValueChange={setSelectedClassId}>
            <SelectTrigger id="workload-class-filter" className="bg-white" data-testid="workload-class-filter">
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLASSES_VALUE}>All Classes</SelectItem>
              {classOptions.map((classItem) => (
                <SelectItem key={classItem.class_id || classItem.class_name} value={classItem.class_id || `archived-${classItem.class_name}`} disabled={!classItem.class_id}>
                  {classItem.class_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="w-full text-sm text-slate-500 mt-1" data-testid="workload-subtitle">
          Team resource allocation and time distribution by class series.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" data-testid="workload-class-chips">
        {classOptions.slice(0, 6).map((classItem) => (
          <Badge
            key={classItem.class_id || classItem.class_name}
            className="border-0 text-xs cursor-pointer hover:opacity-80 transition-opacity"
            style={{ backgroundColor: `${classItem.class_color}20`, color: classItem.class_color }}
            data-testid={`workload-class-chip-${classItem.class_id || classItem.class_name}`}
            onClick={() => classItem.class_id && setSelectedClassId(classItem.class_id)}
          >
            {classItem.class_name}: {classItem.classes}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-indigo-600" />
            </div>
            <span className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Total Classes</span>
          </div>
          <p className="text-3xl font-bold text-slate-800 font-display" data-testid="workload-total-classes">
            {totals.classes}
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-teal-50 rounded-lg flex items-center justify-center">
              <Clock className="w-5 h-5 text-teal-600" />
            </div>
            <span className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Class Hours</span>
          </div>
          <p className="text-3xl font-bold text-slate-800 font-display">
            {totals.classHours.toFixed(1)}h
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-amber-600" />
            </div>
            <span className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Drive Hours</span>
          </div>
          <p className="text-3xl font-bold text-slate-800 font-display">
            {totals.driveHours.toFixed(1)}h
          </p>
        </div>
        <div className="bg-white rounded-lg border border-gray-100 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-spoke-soft rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-spoke" />
            </div>
            <span className="text-xs text-muted-foreground uppercase font-medium tracking-wider">Completed</span>
          </div>
          <p className="text-3xl font-bold text-slate-800 font-display">
            {totals.completed}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 font-display">
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
            <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm" data-testid="workload-chart-empty-state">
              No schedule data yet. Create some classes to see workload distribution.
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-100 p-6">
          <h3 className="text-sm font-semibold text-slate-800 mb-4 font-display">
            Class Distribution
          </h3>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={4} dataKey="value">
                  {pieData.map((entry, i) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm" data-testid="workload-pie-empty-state">
              No data yet
            </div>
          )}
          <div className="space-y-2 mt-2">
            {pieData.map((pieItem) => (
              <div key={pieItem.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: pieItem.color }} />
                  <EntityLink type="employee" id={pieItem.employee_id} className="text-slate-600 truncate max-w-[120px]">{pieItem.name}</EntityLink>
                </div>
                <span className="font-semibold text-slate-800">{pieItem.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {scopedWorkload.map((employeeWorkload) => (
          <div key={employeeWorkload.employee_id} className="bg-white rounded-lg border border-gray-100 p-5 hover:shadow-md transition-shadow" data-testid={`workload-card-${employeeWorkload.employee_id}`}>
            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                style={{ backgroundColor: employeeWorkload.employee_color }}
              >
                {employeeWorkload.employee_name?.charAt(0)?.toUpperCase()}
              </div>
              <div>
                <EntityLink type="employee" id={employeeWorkload.employee_id} className="font-semibold text-slate-800 text-sm">{employeeWorkload.employee_name}</EntityLink>
                <p className="text-xs text-muted-foreground" data-testid={`workload-card-summary-${employeeWorkload.employee_id}`}>
                  {employeeWorkload.display_classes} class{employeeWorkload.display_classes === 1 ? '' : 'es'} in scope
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Class Time</span>
                <span className="font-semibold text-slate-700">{employeeWorkload.display_class_hours}h</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full" style={{ width: `${Math.min((employeeWorkload.display_class_hours / Math.max(...scopedWorkload.map((item) => item.display_class_hours), 1)) * 100, 100)}%`, backgroundColor: employeeWorkload.employee_color }} />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Drive Time</span>
                <span className="font-semibold text-slate-700">{employeeWorkload.display_drive_hours}h</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className="h-2 rounded-full bg-gray-300" style={{ width: `${Math.min((employeeWorkload.display_drive_hours / Math.max(...scopedWorkload.map((item) => item.display_drive_hours), 1)) * 100, 100)}%` }} />
              </div>
              <div className="flex gap-2 mt-3">
                <Badge className="bg-spoke-soft text-spoke border-0 text-[10px]">{employeeWorkload.completed} done</Badge>
                <Badge className="bg-indigo-50 text-indigo-700 border-0 text-[10px]">{employeeWorkload.upcoming} upcoming</Badge>
              </div>
            </div>
          </div>
        ))}

        {scopedWorkload.length === 0 && (
          <div className="col-span-full text-center py-10 text-muted-foreground" data-testid="workload-empty-state">
            No workload found for the selected class.
          </div>
        )}
      </div>
    </div>
  );
}


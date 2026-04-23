import { useState, useMemo } from 'react';
import useSWR from 'swr';
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { TrendingUp, Clock, Car, ArrowRightLeft, Zap } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { analyticsAPI } from '../../lib/api';
import { SummaryCard, LoadingChart, EmptyState, fetcher } from './shared';

export default function DriveOptimizationTab() {
  const today = new Date().toISOString().slice(0, 10);
  const fourWeeks = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(fourWeeks);

  const params = useMemo(() => ({ date_from: dateFrom, date_to: dateTo }), [dateFrom, dateTo]);

  const { data, isLoading } = useSWR(
    ['analytics-drive-opt', params],
    () => fetcher(analyticsAPI.driveOptimization, params),
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      keepPreviousData: true,
      dedupingInterval: 30000,
    }
  );

  const summary = data?.summary || {};
  const employeeDrive = data?.employee_drive || [];
  const suggestions = data?.suggestions || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-2">
          <Label htmlFor="drive-opt-date-from" className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">From</Label>
          <input
            id="drive-opt-date-from"
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-white dark:bg-card px-3 py-2 text-sm ring-offset-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="drive-opt-date-to" className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">To</Label>
          <input
            id="drive-opt-date-to"
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-white dark:bg-card px-3 py-2 text-sm ring-offset-background"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={Car} iconBg="bg-warn-soft" iconColor="text-warn-strong"
          label="Total Drive Hours" value={`${summary.total_drive_hours || 0}h`} />
        <SummaryCard icon={Clock} iconBg="bg-spoke-soft" iconColor="text-spoke-strong"
          label="Avg / Schedule" value={`${summary.avg_per_schedule || 0}h`} />
        <SummaryCard icon={TrendingUp} iconBg="bg-hub-soft" iconColor="text-hub"
          label="Highest Driver" value={summary.highest_driver || 'N/A'} />
        <SummaryCard icon={Zap} iconBg="bg-spoke-soft" iconColor="text-spoke-strong"
          label="Potential Savings" value={`${summary.potential_savings_hours || 0}h`} />
      </div>

      <div className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">
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

      <div className="bg-white dark:bg-card rounded-lg border border-border p-6">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Optimization Suggestions
        </h3>
        {suggestions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Swap</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Locations</th>
                  <th className="text-right py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Savings</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s: any) => {
                  let savingsBadgeClass = 'bg-muted/50 text-foreground/80';
                  if (s.savings_mins >= 120) savingsBadgeClass = 'bg-spoke-soft text-spoke-strong';
                  else if (s.savings_mins >= 60) savingsBadgeClass = 'bg-warn-soft text-warn-strong';

                  return (
                  <tr key={`${s.date}-${s.schedule_a_id}-${s.schedule_b_id}`} className="border-b border-border hover:bg-muted/50">
                    <td className="py-2.5 px-3 text-foreground">{s.date}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 text-foreground">
                        <span className="font-medium">{s.employee_a.split(' ')[0]}</span>
                        <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-medium">{s.employee_b.split(' ')[0]}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-foreground/80 dark:text-muted-foreground text-xs">
                      {s.location_a} / {s.location_b}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <Badge className={`border-0 text-[10px] ${savingsBadgeClass}`}>
                        {s.savings_mins}m saved
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-foreground/80 dark:text-muted-foreground">{s.reason}</td>
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

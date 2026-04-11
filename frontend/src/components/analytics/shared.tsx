import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Label } from '../ui/label';
import type { SummaryCardProps, FilterSelectProps, SelectOption } from '../../lib/types';

export const fetcher = <T,>(apiFn: (params: T) => Promise<{ data: unknown }>, params: T) =>
  apiFn(params).then((r) => r.data);

export function SummaryCard({ icon: Icon, iconBg, iconColor, label, value }: Readonly<SummaryCardProps>) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 ${iconBg} rounded-lg flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-xs text-slate-400 uppercase font-medium tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800 font-display">
        {value}
      </p>
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options }: Readonly<FilterSelectProps>) {
  return (
    <div className="min-w-[160px] space-y-2">
      <Label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt: SelectOption) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function LoadingChart() {
  return (
    <div
      className="h-[320px] flex items-center justify-center"
      role="status"
      aria-label="Loading analytics"
    >
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 border-3 border-hub border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">Loading analytics...</p>
      </div>
    </div>
  );
}

export function EmptyState({ message }: Readonly<{ message: string }>) {
  return (
    <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">
      {message}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { toast } from 'sonner';

const WEEKDAYS = [
  { label: 'S', value: 0 },
  { label: 'M', value: 1 },
  { label: 'T', value: 2 },
  { label: 'W', value: 3 },
  { label: 'T', value: 4 },
  { label: 'F', value: 5 },
  { label: 'S', value: 6 },
];

const getDayValue = (dateStr) => new Date(`${dateStr}T00:00:00`).getDay();

export const createDefaultCustomRecurrence = (dateStr) => ({
  interval: '1',
  frequency: 'week',
  weekdays: [getDayValue(dateStr)],
  end_mode: 'never',
  end_date: '',
  occurrences: '12',
});

export const formatCustomRecurrenceSummary = (rule) => {
  if (!rule) return 'Custom recurrence';

  const unitLabel = `${rule.frequency}${rule.interval === '1' ? '' : 's'}`;
  const weekdaysText = rule.frequency === 'week'
    ? WEEKDAYS.filter((day) => rule.weekdays?.includes(day.value)).map((day) => day.label).join(', ')
    : 'same day of month';

  let endText = 'Ends never (creates the next 52 occurrences for now)';
  if (rule.end_mode === 'on_date') endText = `Ends on ${rule.end_date}`;
  else if (rule.end_mode === 'after_occurrences') endText = `Ends after ${rule.occurrences} occurrences`;

  return `Every ${rule.interval} ${unitLabel} • ${weekdaysText} • ${endText}`;
};

export default function CustomRecurrenceDialog({ open, onOpenChange, startDate, value, onSave }) {
  const [draft, setDraft] = useState(createDefaultCustomRecurrence(startDate));

  useEffect(() => {
    if (!open) return;
    setDraft(value || createDefaultCustomRecurrence(startDate));
  }, [open, startDate, value]);

  const toggleWeekday = (weekday) => {
    setDraft((prev) => {
      const exists = prev.weekdays.includes(weekday);
      return {
        ...prev,
        weekdays: exists
          ? prev.weekdays.filter((day) => day !== weekday)
          : [...prev.weekdays, weekday].sort((a, b) => a - b),
      };
    });
  };

  const handleSave = () => {
    const interval = Number.parseInt(draft.interval, 10);
    const occurrences = Number.parseInt(draft.occurrences, 10);

    if (!interval || interval < 1) {
      toast.error('Repeat interval must be at least 1');
      return;
    }

    if (draft.frequency === 'week' && (!draft.weekdays || draft.weekdays.length === 0)) {
      toast.error('Select at least one day of the week');
      return;
    }

    if (draft.end_mode === 'on_date' && !draft.end_date) {
      toast.error('Choose an end date');
      return;
    }

    if (draft.end_mode === 'after_occurrences' && (!occurrences || occurrences < 1)) {
      toast.error('Occurrences must be at least 1');
      return;
    }

    onSave?.({
      ...draft,
      interval: String(interval),
      occurrences: String(occurrences || 1),
      weekdays: draft.frequency === 'week' ? draft.weekdays : [],
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-white dark:bg-gray-900" data-testid="custom-recurrence-dialog">
        <DialogHeader>
          <DialogTitle>Custom recurrence</DialogTitle>
          <DialogDescription>
            Build a more flexible repeat rule inspired by calendar event tools.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-[120px_120px_1fr] gap-3 items-end">
            <div className="space-y-2">
              <Label htmlFor="custom-repeat-interval">Repeat every</Label>
              <Input
                id="custom-repeat-interval"
                type="number"
                min="1"
                value={draft.interval}
                onChange={(e) => setDraft((prev) => ({ ...prev, interval: e.target.value }))}
                data-testid="custom-repeat-interval"
                className="bg-gray-50/50 dark:bg-gray-800"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-repeat-frequency">Unit</Label>
              <Select value={draft.frequency} onValueChange={(value) => setDraft((prev) => ({ ...prev, frequency: value }))}>
                <SelectTrigger id="custom-repeat-frequency" className="bg-gray-50/50 dark:bg-gray-800" data-testid="custom-repeat-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {draft.frequency === 'week' && (
            <fieldset className="space-y-2 border-0 p-0 m-0">
              {/* Use a semantic <fieldset>/<legend> for the weekday toggle
                  group instead of role="group" — Sonar/axe prefer native
                  HTML landmarks over ARIA roles when available. */}
              <legend
                id="custom-repeat-days-label"
                data-testid="custom-repeat-days-label"
                className="text-sm font-medium leading-none mb-2"
              >
                Repeat on
              </legend>
              <div className="flex gap-2 flex-wrap" data-testid="custom-repeat-days">
                {WEEKDAYS.map((day, index) => {
                  const active = draft.weekdays.includes(day.value);
                  return (
                    <button
                      key={`${day.label}-${index}`}
                      type="button"
                      aria-pressed={active}
                      data-testid={`custom-repeat-day-${day.value}`}
                      onClick={() => toggleWeekday(day.value)}
                      className={`w-10 h-10 rounded-full text-sm font-semibold transition-all ${active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 hover:bg-slate-200 dark:hover:bg-gray-700'}`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div
            className="space-y-3"
            role="radiogroup"
            aria-labelledby="custom-repeat-ends-label"
          >
            {/* Group heading for the end-mode radio choices. */}
            <span
              id="custom-repeat-ends-label"
              data-testid="custom-repeat-ends-label"
              className="text-sm font-medium leading-none"
            >
              Ends
            </span>
            <div className="grid gap-3">
              <button
                type="button"
                role="radio"
                aria-checked={draft.end_mode === 'never'}
                data-testid="custom-repeat-end-never"
                onClick={() => setDraft((prev) => ({ ...prev, end_mode: 'never' }))}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left ${draft.end_mode === 'never' ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}
              >
                <div className={`w-4 h-4 rounded-full border ${draft.end_mode === 'never' ? 'border-4 border-indigo-600' : 'border-gray-300 dark:border-gray-600'}`} />
                <span className="text-sm font-medium text-slate-700 dark:text-gray-200">Never</span>
              </button>

              <div className={`rounded-lg border px-4 py-3 ${draft.end_mode === 'on_date' ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.end_mode === 'on_date'}
                  data-testid="custom-repeat-end-date"
                  onClick={() => setDraft((prev) => ({ ...prev, end_mode: 'on_date' }))}
                  className="flex items-center gap-3 w-full text-left"
                >
                  <div className={`w-4 h-4 rounded-full border ${draft.end_mode === 'on_date' ? 'border-4 border-indigo-600' : 'border-gray-300 dark:border-gray-600'}`} />
                  <span className="text-sm font-medium text-slate-700 dark:text-gray-200">On</span>
                </button>
                {draft.end_mode === 'on_date' && (
                  <Input
                    type="date"
                    value={draft.end_date}
                    onChange={(e) => setDraft((prev) => ({ ...prev, end_date: e.target.value }))}
                    className="mt-3 bg-white dark:bg-gray-900"
                    data-testid="custom-repeat-end-date-input"
                  />
                )}
              </div>

              <div className={`rounded-lg border px-4 py-3 ${draft.end_mode === 'after_occurrences' ? 'border-indigo-300 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-700' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900'}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.end_mode === 'after_occurrences'}
                  data-testid="custom-repeat-end-after"
                  onClick={() => setDraft((prev) => ({ ...prev, end_mode: 'after_occurrences' }))}
                  className="flex items-center gap-3 w-full text-left"
                >
                  <div className={`w-4 h-4 rounded-full border ${draft.end_mode === 'after_occurrences' ? 'border-4 border-indigo-600' : 'border-gray-300 dark:border-gray-600'}`} />
                  <span className="text-sm font-medium text-slate-700 dark:text-gray-200">After</span>
                </button>
                {draft.end_mode === 'after_occurrences' && (
                  <div className="mt-3 flex items-center gap-3">
                    <Input
                      type="number"
                      min="1"
                      value={draft.occurrences}
                      onChange={(e) => setDraft((prev) => ({ ...prev, occurrences: e.target.value }))}
                      className="max-w-[160px] bg-white dark:bg-gray-900"
                      data-testid="custom-repeat-occurrences-input"
                    />
                    <span className="text-sm text-slate-500 dark:text-gray-400">occurrences</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground" data-testid="custom-repeat-note">
            Never-ending rules create the next 52 occurrences for now so scheduling stays manageable.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="custom-repeat-cancel-button">
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white" data-testid="custom-repeat-save-button">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


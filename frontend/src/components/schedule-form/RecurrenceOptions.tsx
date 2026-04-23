import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { formatCustomRecurrenceSummary } from '../CustomRecurrenceDialog';
import { Button } from '../ui/button';

export function RecurrenceOptions({
  form,
  setForm,
  customRecurrence,
  onRecurrenceChange,
  openCustomModal,
}) {
  const {
    recurrence = 'none',
    recurrence_end_mode = 'never',
    recurrence_end_date = '',
    recurrence_occurrences = '',
  } = form;
  const endModeButtonClass = (mode: string) =>
    `rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1 ${
      recurrence_end_mode === mode
        ? 'border-hub/40 bg-hub-soft text-hub-strong'
        : 'border-border bg-white dark:bg-card text-foreground/80 dark:text-muted-foreground hover:bg-muted/50 dark:hover:bg-muted'
    }`;

  return (
    <div className="space-y-2">
      <Label htmlFor="schedule-recurrence-select" className="text-sm font-medium text-foreground">Repeat</Label>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Select value={recurrence} onValueChange={onRecurrenceChange}>
            <SelectTrigger
              id="schedule-recurrence-select"
              data-testid="schedule-recurrence-select"
              className="h-10 bg-muted/50 dark:bg-muted/50 flex-1"
            >
              <SelectValue placeholder="No repeat" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No repeat</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Every 2 weeks</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="custom">Custom...</SelectItem>
            </SelectContent>
          </Select>

          {recurrence === 'custom' && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={openCustomModal}
              data-testid="schedule-custom-recurrence-button"
            >
              Customize
            </Button>
          )}
        </div>

        {recurrence !== 'none' && recurrence !== 'custom' && (
          // Outer container is presentational; the inner radiogroup owns
          // the ARIA grouping so a wrapper role="group" would be redundant.
          <div
            className="rounded-lg border border-border bg-muted/50/70 dark:bg-muted/70 p-3 space-y-3"
            data-testid="schedule-repeat-settings"
          >
            <div className="space-y-2">
              <p
                id="schedule-end-mode-label"
                className="text-xs uppercase tracking-[0.18em] text-muted-foreground"
              >
                Ends
              </p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="schedule-end-mode-label">
                <button
                  type="button"
                  role="radio"
                  aria-checked={recurrence_end_mode === 'never'}
                  data-testid="repeat-end-never"
                  onClick={() => setForm((prev) => ({ ...prev, recurrence_end_mode: 'never' }))}
                  className={endModeButtonClass('never')}
                >
                  Never
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={recurrence_end_mode === 'on_date'}
                  data-testid="repeat-end-on-date"
                  onClick={() => setForm((prev) => ({ ...prev, recurrence_end_mode: 'on_date' }))}
                  className={endModeButtonClass('on_date')}
                >
                  On date
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={recurrence_end_mode === 'after_occurrences'}
                  data-testid="repeat-end-after-count"
                  onClick={() => setForm((prev) => ({ ...prev, recurrence_end_mode: 'after_occurrences' }))}
                  className={endModeButtonClass('after_occurrences')}
                >
                  After
                </button>
              </div>
            </div>

            {recurrence_end_mode === 'on_date' && (
              <div className="space-y-1">
                <Label htmlFor="schedule-recurrence-end" className="sr-only">Recurrence end date</Label>
                <Input
                  id="schedule-recurrence-end"
                  type="date"
                  data-testid="schedule-recurrence-end"
                  value={recurrence_end_date}
                  onChange={(e) => setForm({ ...form, recurrence_end_date: e.target.value })}
                  className="h-10 bg-white dark:bg-card"
                  placeholder="End date"
                />
              </div>
            )}

            {recurrence_end_mode === 'after_occurrences' && (
              <div className="flex items-center gap-3">
                <Label htmlFor="schedule-recurrence-occurrences" className="sr-only">Number of occurrences</Label>
                <Input
                  id="schedule-recurrence-occurrences"
                  type="number"
                  min="1"
                  data-testid="schedule-recurrence-occurrences"
                  value={recurrence_occurrences}
                  onChange={(e) => setForm({ ...form, recurrence_occurrences: e.target.value })}
                  className="h-10 bg-white dark:bg-card max-w-[160px]"
                  placeholder="12"
                />
                <span className="text-sm text-foreground/80 dark:text-muted-foreground">occurrences</span>
              </div>
            )}

            {recurrence_end_mode === 'never' && (
              <p className="text-xs text-muted-foreground" data-testid="schedule-recurrence-never-note">
                Never creates the next 52 occurrences for now.
              </p>
            )}
          </div>
        )}

        {recurrence === 'custom' && (
          <div className="rounded-lg border border-hub/20 bg-hub-soft p-3" data-testid="schedule-custom-recurrence-summary">
            <p className="text-xs uppercase tracking-[0.18em] text-hub">Custom rule</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {formatCustomRecurrenceSummary(customRecurrence)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

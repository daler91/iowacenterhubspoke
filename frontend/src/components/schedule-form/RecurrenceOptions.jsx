import PropTypes from 'prop-types';
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
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-slate-700">Repeat</Label>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Select value={form.recurrence || 'none'} onValueChange={onRecurrenceChange}>
            <SelectTrigger data-testid="schedule-recurrence-select" className="h-10 bg-gray-50/50 flex-1">
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

          {form.recurrence === 'custom' && (
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

        {form.recurrence !== 'none' && form.recurrence !== 'custom' && (
          <div className="rounded-xl border border-gray-100 bg-slate-50/70 p-3 space-y-3" data-testid="schedule-repeat-settings">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.18em] text-slate-400">Ends</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  data-testid="repeat-end-never"
                  onClick={() => setForm((prev) => ({ ...prev, recurrence_end_mode: 'never' }))}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${form.recurrence_end_mode === 'never' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-slate-500'}`}
                >
                  Never
                </button>
                <button
                  type="button"
                  data-testid="repeat-end-on-date"
                  onClick={() => setForm((prev) => ({ ...prev, recurrence_end_mode: 'on_date' }))}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${form.recurrence_end_mode === 'on_date' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-slate-500'}`}
                >
                  On date
                </button>
                <button
                  type="button"
                  data-testid="repeat-end-after-count"
                  onClick={() => setForm((prev) => ({ ...prev, recurrence_end_mode: 'after_occurrences' }))}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium ${form.recurrence_end_mode === 'after_occurrences' ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-gray-200 bg-white text-slate-500'}`}
                >
                  After
                </button>
              </div>
            </div>

            {form.recurrence_end_mode === 'on_date' && (
              <Input
                type="date"
                data-testid="schedule-recurrence-end"
                value={form.recurrence_end_date || ''}
                onChange={(e) => setForm({ ...form, recurrence_end_date: e.target.value })}
                className="h-10 bg-white"
                placeholder="End date"
              />
            )}

            {form.recurrence_end_mode === 'after_occurrences' && (
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min="1"
                  data-testid="schedule-recurrence-occurrences"
                  value={form.recurrence_occurrences || ''}
                  onChange={(e) => setForm({ ...form, recurrence_occurrences: e.target.value })}
                  className="h-10 bg-white max-w-[160px]"
                  placeholder="12"
                />
                <span className="text-sm text-slate-500">occurrences</span>
              </div>
            )}

            {form.recurrence_end_mode === 'never' && (
              <p className="text-xs text-slate-400" data-testid="schedule-recurrence-never-note">
                Never creates the next 52 occurrences for now.
              </p>
            )}
          </div>
        )}

        {form.recurrence === 'custom' && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3" data-testid="schedule-custom-recurrence-summary">
            <p className="text-xs uppercase tracking-[0.18em] text-indigo-400">Custom rule</p>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {formatCustomRecurrenceSummary(customRecurrence)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

RecurrenceOptions.propTypes = {
  form: PropTypes.shape({
    recurrence: PropTypes.string,
    recurrence_end_mode: PropTypes.string,
    recurrence_end_date: PropTypes.string,
    recurrence_occurrences: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
  setForm: PropTypes.func.isRequired,
  customRecurrence: PropTypes.object,
  onRecurrenceChange: PropTypes.func.isRequired,
  openCustomModal: PropTypes.func.isRequired,
};

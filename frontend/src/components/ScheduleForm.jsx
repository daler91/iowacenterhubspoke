import { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { AlertTriangle, Clock, MapPin, Car, Trash2, PlusCircle, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import ClassQuickCreateDialog from './ClassQuickCreateDialog';
import CustomRecurrenceDialog, { createDefaultCustomRecurrence, formatCustomRecurrenceSummary } from './CustomRecurrenceDialog';

const CREATE_CLASS_VALUE = '__add_new_class__';
const getDayValue = (dateStr) => new Date(`${dateStr}T00:00:00`).getDay();

export default function ScheduleForm({ open, onOpenChange, locations, employees, classes, editSchedule, onSaved, onClassCreated }) {
  const [form, setForm] = useState({
    employee_id: '',
    class_id: '',
    location_id: '',
    date: '',
    start_time: '09:00',
    end_time: '12:00',
    notes: '',
    travel_override_minutes: null,
    recurrence: 'none',
    recurrence_end_mode: 'never',
    recurrence_end_date: '',
    recurrence_occurrences: '',
  });
  const [loading, setLoading] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [quickClassOpen, setQuickClassOpen] = useState(false);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);
  const [customRecurrence, setCustomRecurrence] = useState(createDefaultCustomRecurrence(new Date().toISOString().split('T')[0]));

  useEffect(() => {
    if (editSchedule) {
      setForm({
        employee_id: editSchedule.employee_id,
        class_id: editSchedule.class_id || '',
        location_id: editSchedule.location_id,
        date: editSchedule.date,
        start_time: editSchedule.start_time,
        end_time: editSchedule.end_time,
        notes: editSchedule.notes || '',
        travel_override_minutes: editSchedule.travel_override_minutes || null,
        recurrence: 'none',
        recurrence_end_mode: 'never',
        recurrence_end_date: '',
        recurrence_occurrences: '',
      });
      if (editSchedule.town_to_town) setShowOverride(true);
    } else {
      const startDate = new Date().toISOString().split('T')[0];
      setForm({
        employee_id: '',
        class_id: '',
        location_id: '',
        date: startDate,
        start_time: '09:00',
        end_time: '12:00',
        notes: '',
        travel_override_minutes: null,
        recurrence: 'none',
        recurrence_end_mode: 'never',
        recurrence_end_date: '',
        recurrence_occurrences: '',
      });
      setCustomRecurrence(createDefaultCustomRecurrence(startDate));
      setShowOverride(false);
    }
  }, [editSchedule, open]);

  const selectedLocation = locations?.find(l => l.id === form.location_id);
  const selectedClass = classes?.find(c => c.id === form.class_id);

  const handleClassSelection = (value) => {
    if (value === CREATE_CLASS_VALUE) {
      setQuickClassOpen(true);
      return;
    }
    setForm((prev) => ({ ...prev, class_id: value }));
  };

  const handleQuickClassCreated = (classDoc) => {
    onClassCreated?.(classDoc);
    setForm((prev) => ({ ...prev, class_id: classDoc.id }));
  };

  const handleRecurrenceChange = (value) => {
    setForm((prev) => ({
      ...prev,
      recurrence: value,
      recurrence_end_mode: value === 'none' ? 'never' : prev.recurrence_end_mode,
    }));

    if (value === 'custom') {
      setCustomRecurrenceOpen(true);
    }
  };

  const validateRecurrence = () => {
    if (form.recurrence === 'none' || editSchedule) return true;

    if (form.recurrence === 'custom') {
      if (customRecurrence.frequency === 'week' && (!customRecurrence.weekdays || customRecurrence.weekdays.length === 0)) {
        toast.error('Choose at least one weekday for custom recurrence');
        return false;
      }
      if (customRecurrence.end_mode === 'on_date' && !customRecurrence.end_date) {
        toast.error('Choose an end date for the custom recurrence');
        return false;
      }
      if (customRecurrence.end_mode === 'after_occurrences' && (!customRecurrence.occurrences || Number.parseInt(customRecurrence.occurrences, 10) < 1)) {
        toast.error('Enter a valid number of occurrences');
        return false;
      }
      return true;
    }

    if (isCustom && recData.frequency === 'week' && (!recData.weekdays || recData.weekdays.length === 0)) {
      toast.error('Choose at least one weekday for custom recurrence');
      return false;
    }

    if (form.recurrence_end_mode === 'after_occurrences' && (!form.recurrence_occurrences || Number.parseInt(form.recurrence_occurrences, 10) < 1)) {
      toast.error('Enter a valid number of occurrences');
      return false;
    }
    return true;
  };

  const buildPayload = () => {
    const isCustom = form.recurrence === 'custom';
    const isNone = form.recurrence === 'none';
    const travelMinutes = form.travel_override_minutes ? Number.parseInt(form.travel_override_minutes, 10) : null;
    const classId = form.class_id || null;
    const payload = { ...form, class_id: classId, travel_override_minutes: travelMinutes };

    if (isNone) {
      return { ...payload, recurrence: null, recurrence_end_mode: null, recurrence_end_date: null, recurrence_occurrences: null, custom_recurrence: null };
    }

    const recurrenceOccurrences = isCustom && customRecurrence.end_mode === 'after_occurrences'
      ? Number.parseInt(customRecurrence.occurrences, 10)
      : form.recurrence_end_mode === 'after_occurrences'
        ? Number.parseInt(form.recurrence_occurrences, 10)
        : null;

    const customRecurrencePayload = isCustom ? {
      interval: Number.parseInt(customRecurrence.interval, 10),
      frequency: customRecurrence.frequency,
      weekdays: customRecurrence.frequency === 'week' ? customRecurrence.weekdays : [],
      end_mode: customRecurrence.end_mode,
      end_date: customRecurrence.end_mode === 'on_date' ? customRecurrence.end_date || null : null,
      occurrences: customRecurrence.end_mode === 'after_occurrences' ? Number.parseInt(customRecurrence.occurrences, 10) : null,
    } : null;

    return {
      ...payload,
      recurrence: form.recurrence,
      recurrence_end_mode: endMode,
      recurrence_end_date: recurrenceEndDate,
      recurrence_occurrences: recurrenceOccurrences,
      custom_recurrence: customRecurrencePayload,
    };
  };

  const handleCreateResponse = (res) => {
    if (res.data.town_to_town_warning) {
      toast.warning(res.data.town_to_town_warning, { duration: 6000 });
    } else if (res.data.total_created === undefined) {
      toast.success('Class scheduled successfully');
    } else {
      const skipped = res.data.conflicts_skipped?.length || 0;
      const skippedMsg = skipped ? `, ${skipped} skipped (conflicts)` : '';
      toast.success(`${res.data.total_created} classes created${skippedMsg}`);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.employee_id || !form.location_id || !form.date || !form.start_time || !form.end_time) {
      toast.error('Please fill all required fields');
      return;
    }
    if (!editSchedule && !form.class_id) {
      toast.error('Please select or create a class type');
      return;
    }
    if (!validateRecurrence()) {
      return;
    }
    setLoading(true);
    try {
      const payload = buildPayload();
      if (editSchedule) {
        await schedulesAPI.update(editSchedule.id, payload);
        toast.success('Schedule updated');
      } else {
        handleCreateResponse(await schedulesAPI.create(payload));
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      if (err.response?.status === 409) {
        const detail = err.response.data?.detail;
        const msg = detail?.message || 'Schedule conflict detected';
        const conflicts = detail?.conflicts || [];
        const conflictList = conflicts.map(c => `${c.location} (${c.time})`).join(', ');
        toast.error(`${msg}: ${conflictList}`, { duration: 8000 });
      } else {
        toast.error(err.response?.data?.detail || 'Failed to save schedule');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!editSchedule) return;
    setLoading(true);
    try {
      await schedulesAPI.delete(editSchedule.id);
      toast.success('Schedule deleted');
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete schedule');
    } finally {
      setLoading(false);
    }
  };

  let submitLabel = 'Schedule Class';
  if (loading) submitLabel = 'Saving...';
  else if (editSchedule) submitLabel = 'Update Schedule';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-white" data-testid="schedule-form-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {editSchedule ? 'Edit Schedule' : 'Schedule a Class'}
          </DialogTitle>
          <DialogDescription>
            {editSchedule ? 'Update the class details below.' : 'Assign an employee to a class at a location. Drive time will be automatically calculated.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Employee Select */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Employee</Label>
            <Select value={form.employee_id} onValueChange={(v) => setForm({ ...form, employee_id: v })}>
              <SelectTrigger data-testid="schedule-employee-select" className="h-10 bg-gray-50/50">
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                {(employees || []).map(emp => (
                  <SelectItem key={emp.id} value={emp.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: emp.color }} />
                      {emp.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Class Select */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm font-medium text-slate-700">Class Type</Label>
              <button
                type="button"
                data-testid="schedule-add-class-inline-button"
                onClick={() => setQuickClassOpen(true)}
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
              >
                <PlusCircle className="w-3 h-3" />
                Add New Class
              </button>
            </div>
            <Select value={form.class_id || undefined} onValueChange={handleClassSelection}>
              <SelectTrigger data-testid="schedule-class-select" className="h-10 bg-gray-50/50">
                <SelectValue placeholder="Select a class type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CREATE_CLASS_VALUE} data-testid="schedule-class-add-new-option">
                  <div className="flex items-center gap-2 text-indigo-700">
                    <PlusCircle className="w-3.5 h-3.5" />
                    Add New Class...
                  </div>
                </SelectItem>
                {(classes || []).map(classItem => (
                  <SelectItem key={classItem.id} value={classItem.id}>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: classItem.color || '#0F766E' }} />
                      <span>{classItem.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedClass && (
              <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-emerald-50/60 px-3 py-2" data-testid="schedule-selected-class-preview">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: selectedClass.color || '#0F766E' }}>
                  <BookOpen className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800" data-testid="schedule-selected-class-name">{selectedClass.name}</p>
                  <p className="text-xs text-slate-500 break-words" data-testid="schedule-selected-class-description">
                    {selectedClass.description || 'No class description added.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Location Select */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Location</Label>
            <Select value={form.location_id} onValueChange={(v) => setForm({ ...form, location_id: v })}>
              <SelectTrigger data-testid="schedule-location-select" className="h-10 bg-gray-50/50">
                <SelectValue placeholder="Select a location" />
              </SelectTrigger>
              <SelectContent>
                {(locations || []).map(loc => (
                  <SelectItem key={loc.id} value={loc.id}>
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-teal-600" />
                      {loc.city_name}
                      <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600">
                        {loc.drive_time_minutes}m
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLocation && (
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                <Car className="w-4 h-4 text-slate-400" />
                <span className="text-xs text-slate-500">
                  Estimated drive: <span className="font-semibold text-slate-700">{selectedLocation.drive_time_minutes} min</span> each way from Hub
                </span>
              </div>
            )}
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Date</Label>
              <Input
                type="date"
                data-testid="schedule-date-input"
                value={form.date}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  setForm({ ...form, date: nextDate });
                  setCustomRecurrence((prev) => (
                    prev.frequency === 'week' && (!prev.weekdays || prev.weekdays.length === 0)
                      ? { ...prev, weekdays: [getDayValue(nextDate)] }
                      : prev
                  ));
                }}
                className="h-10 bg-gray-50/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Start Time</Label>
              <Input
                type="time"
                data-testid="schedule-start-time"
                value={form.start_time}
                onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                className="h-10 bg-gray-50/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">End Time</Label>
              <Input
                type="time"
                data-testid="schedule-end-time"
                value={form.end_time}
                onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                className="h-10 bg-gray-50/50"
                required
              />
            </div>
          </div>

          {/* Travel Override */}
          <div>
            <button
              type="button"
              data-testid="toggle-travel-override"
              onClick={() => setShowOverride(!showOverride)}
              className="text-xs text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1"
            >
              <Clock className="w-3 h-3" />
              {showOverride ? 'Hide' : 'Override'} travel time
            </button>
            {showOverride && (
              <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold text-amber-700">
                    Town-to-Town Travel: Verify drive time manually
                  </span>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-amber-700">Override drive time (minutes)</Label>
                  <Input
                    type="number"
                    data-testid="travel-override-input"
                    placeholder="e.g. 45"
                    value={form.travel_override_minutes || ''}
                    onChange={(e) => setForm({ ...form, travel_override_minutes: e.target.value })}
                    className="h-9 bg-white"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-slate-700">Notes (optional)</Label>
            <Input
              data-testid="schedule-notes-input"
              placeholder="Additional notes..."
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="h-10 bg-gray-50/50"
            />
          </div>

          {/* Recurrence */}
          {!editSchedule && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Repeat</Label>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Select value={form.recurrence || 'none'} onValueChange={handleRecurrenceChange}>
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
                      onClick={() => setCustomRecurrenceOpen(true)}
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
          )}

          <DialogFooter className="flex gap-2">
            {editSchedule && (
              <Button
                type="button"
                variant="outline"
                data-testid="schedule-delete-btn"
                onClick={handleDelete}
                disabled={loading}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
            )}
            <Button
              type="submit"
              data-testid="schedule-save-btn"
              disabled={loading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white flex-1"
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ClassQuickCreateDialog
        open={quickClassOpen}
        onOpenChange={setQuickClassOpen}
        onCreated={handleQuickClassCreated}
      />
      <CustomRecurrenceDialog
        open={customRecurrenceOpen}
        onOpenChange={setCustomRecurrenceOpen}
        startDate={form.date}
        value={customRecurrence}
        onSave={setCustomRecurrence}
      />
    </Dialog>
  );
}

ScheduleForm.propTypes = {
  open: PropTypes.bool.isRequired,
  onOpenChange: PropTypes.func.isRequired,
  locations: PropTypes.array,
  employees: PropTypes.array,
  classes: PropTypes.array,
  editSchedule: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    employee_id: PropTypes.string,
    class_id: PropTypes.string,
    location_id: PropTypes.string,
    date: PropTypes.string,
    start_time: PropTypes.string,
    end_time: PropTypes.string,
    notes: PropTypes.string,
    travel_override_minutes: PropTypes.number,
    town_to_town: PropTypes.bool,
  }),
  onSaved: PropTypes.func,
  onClassCreated: PropTypes.func,
};

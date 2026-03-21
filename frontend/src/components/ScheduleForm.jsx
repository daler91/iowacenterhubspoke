import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { AlertTriangle, Clock, MapPin, Car, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';

export default function ScheduleForm({ open, onOpenChange, locations, employees, editSchedule, onSaved }) {
  const [form, setForm] = useState({
    employee_id: '',
    location_id: '',
    date: '',
    start_time: '09:00',
    end_time: '12:00',
    notes: '',
    travel_override_minutes: null,
    recurrence: 'none',
    recurrence_end_date: '',
  });
  const [loading, setLoading] = useState(false);
  const [showOverride, setShowOverride] = useState(false);

  useEffect(() => {
    if (editSchedule) {
      setForm({
        employee_id: editSchedule.employee_id,
        location_id: editSchedule.location_id,
        date: editSchedule.date,
        start_time: editSchedule.start_time,
        end_time: editSchedule.end_time,
        notes: editSchedule.notes || '',
        travel_override_minutes: editSchedule.travel_override_minutes || null,
        recurrence: 'none',
        recurrence_end_date: '',
      });
      if (editSchedule.town_to_town) setShowOverride(true);
    } else {
      setForm({
        employee_id: '',
        location_id: '',
        date: new Date().toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '12:00',
        notes: '',
        travel_override_minutes: null,
        recurrence: 'none',
        recurrence_end_date: '',
      });
      setShowOverride(false);
    }
  }, [editSchedule, open]);

  const selectedLocation = locations?.find(l => l.id === form.location_id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.employee_id || !form.location_id || !form.date || !form.start_time || !form.end_time) {
      toast.error('Please fill all required fields');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        ...form,
        travel_override_minutes: form.travel_override_minutes ? parseInt(form.travel_override_minutes) : null,
        recurrence: form.recurrence === 'none' ? null : form.recurrence,
        recurrence_end_date: form.recurrence_end_date || null,
      };
      if (editSchedule) {
        await schedulesAPI.update(editSchedule.id, payload);
        toast.success('Schedule updated');
      } else {
        const res = await schedulesAPI.create(payload);
        if (res.data.town_to_town_warning) {
          toast.warning(res.data.town_to_town_warning, { duration: 6000 });
        } else if (res.data.total_created !== undefined) {
          const skipped = res.data.conflicts_skipped?.length || 0;
          toast.success(`${res.data.total_created} classes created${skipped ? `, ${skipped} skipped (conflicts)` : ''}`);
        } else {
          toast.success('Class scheduled successfully');
        }
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      if (err.response?.status === 409) {
        const detail = err.response.data?.detail;
        const msg = detail?.message || 'Schedule conflict detected';
        const conflicts = detail?.conflicts || [];
        toast.error(`${msg}: ${conflicts.map(c => `${c.location} (${c.time})`).join(', ')}`, { duration: 8000 });
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
      toast.error('Failed to delete schedule');
    } finally {
      setLoading(false);
    }
  };

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
                onChange={(e) => setForm({ ...form, date: e.target.value })}
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
              <div className="flex items-center gap-3">
                <Select value={form.recurrence || 'none'} onValueChange={(v) => setForm({ ...form, recurrence: v })}>
                  <SelectTrigger data-testid="schedule-recurrence-select" className="h-10 bg-gray-50/50 flex-1">
                    <SelectValue placeholder="No repeat" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No repeat</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                  </SelectContent>
                </Select>
                {form.recurrence && form.recurrence !== 'none' && (
                  <Input
                    type="date"
                    data-testid="schedule-recurrence-end"
                    value={form.recurrence_end_date || ''}
                    onChange={(e) => setForm({ ...form, recurrence_end_date: e.target.value })}
                    className="h-10 bg-gray-50/50 flex-1"
                    placeholder="End date"
                  />
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
              {loading ? 'Saving...' : editSchedule ? 'Update Schedule' : 'Schedule Class'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

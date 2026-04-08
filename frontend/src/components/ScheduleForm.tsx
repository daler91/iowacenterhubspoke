import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Trash2, Repeat } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ClassQuickCreateDialog from './ClassQuickCreateDialog';
import CustomRecurrenceDialog from './CustomRecurrenceDialog';
import { schedulesAPI } from '../lib/api';
import { toast } from 'sonner';

import { useScheduleForm } from '../hooks/useScheduleForm';
import { EmployeeClassSelectors } from './schedule-form/EmployeeClassSelectors';
import { LocationTimeSelectors } from './schedule-form/LocationTimeSelectors';
import { RecurrenceOptions } from './schedule-form/RecurrenceOptions';

export default function ScheduleForm({ open, onOpenChange, locations, employees, classes, editSchedule, onSaved, onClassCreated }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';
  const isAdmin = user?.role === 'admin';
  const [seriesAction, setSeriesAction] = useState<'this' | 'future'>('this');
  const [showSeriesDeleteConfirm, setShowSeriesDeleteConfirm] = useState(false);
  const hasSeries = !!editSchedule?.series_id;

  const {
    form, setForm,
    loading,
    quickClassOpen, setQuickClassOpen,
    customRecurrenceOpen, setCustomRecurrenceOpen,
    customRecurrence, setCustomRecurrence,
    previewConflicts, travelChain, outlookOverride, googleOverride,
    handleSubmit, handleDelete,
    handleDateChange, handleRecurrenceChange, handleOverrideChange
  } = useScheduleForm({ open, editSchedule, onSaved, onOpenChange });

  const selectedLocation = locations?.find(l => l.id === form.location_id);
  const selectedClass = classes?.find(c => c.id === form.class_id);

  const handleQuickClassCreated = (classDoc) => {
    onClassCreated?.(classDoc);
    setForm((prev) => ({ ...prev, class_id: classDoc.id }));
  };

  const employeeCount = form.employee_ids?.length || 0;
  let submitLabel = 'Schedule Class';
  if (loading) submitLabel = 'Saving...';
  else if (outlookOverride || googleOverride) submitLabel = 'Schedule Anyway';
  else if (editSchedule) submitLabel = employeeCount > 1 ? `Update (${employeeCount} Employees)` : 'Update Schedule';
  else if (employeeCount > 1) submitLabel = `Schedule ${employeeCount} Employees`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-white overflow-y-auto max-h-[90vh]" data-testid="schedule-form-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {editSchedule ? 'Edit Schedule' : 'Schedule a Class'}
          </DialogTitle>
          <DialogDescription>
            {editSchedule ? 'Update the class details below. Add more employees to schedule them for the same class.' : 'Assign one or more employees to a class at a location. Drive time will be automatically calculated.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {editSchedule && hasSeries && (
            <div className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border">
              <Repeat className="w-4 h-4 text-indigo-500 shrink-0" />
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="seriesAction" value="this" checked={seriesAction === 'this'}
                    onChange={() => setSeriesAction('this')} className="accent-indigo-600" />
                  This schedule only
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="seriesAction" value="future" checked={seriesAction === 'future'}
                    onChange={() => setSeriesAction('future')} className="accent-indigo-600" />
                  All future in series
                </label>
              </div>
            </div>
          )}

          <EmployeeClassSelectors
            form={form}
            setForm={setForm}
            employees={employees}
            classes={classes}
            selectedClass={selectedClass}
            onAddClass={isAdmin ? () => setQuickClassOpen(true) : null}
          />

          <LocationTimeSelectors
            form={form}
            setForm={setForm}
            locations={locations}
            selectedLocation={selectedLocation}
            onDateChange={handleDateChange}
            previewConflicts={previewConflicts}
            travelChain={travelChain}
            onOverrideChange={handleOverrideChange}
          />

          {!editSchedule && (
            <RecurrenceOptions 
              form={form}
              setForm={setForm}
              customRecurrence={customRecurrence}
              onRecurrenceChange={handleRecurrenceChange}
              openCustomModal={() => setCustomRecurrenceOpen(true)}
            />
          )}

          <DialogFooter className="flex gap-2 pt-4">
            {editSchedule && canEdit && (
              <Button
                type="button"
                variant="outline"
                data-testid="schedule-delete-btn"
                onClick={() => {
                  if (hasSeries && seriesAction === 'future') {
                    setShowSeriesDeleteConfirm(true);
                  } else {
                    handleDelete();
                  }
                }}
                disabled={loading}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                {hasSeries && seriesAction === 'future' ? 'Delete Series' : 'Delete'}
              </Button>
            )}
            <Button
              type="submit"
              data-testid="schedule-save-btn"
              disabled={loading}
              className={`${outlookOverride || googleOverride ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white flex-1`}
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

      {/* Series Delete Confirmation */}
      <Dialog open={showSeriesDeleteConfirm} onOpenChange={setShowSeriesDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete All Future Schedules?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This will delete all future schedules in this recurring series. Past schedules will be preserved.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSeriesDeleteConfirm(false)}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                try {
                  await schedulesAPI.deleteSeries(editSchedule.series_id);
                  toast.success('Future schedules in series deleted');
                  setShowSeriesDeleteConfirm(false);
                  onSaved?.();
                  onOpenChange?.(false);
                } catch {
                  toast.error('Failed to delete series');
                }
              }}
            >
              Delete All Future
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

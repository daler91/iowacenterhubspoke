import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ClassQuickCreateDialog from './ClassQuickCreateDialog';
import CustomRecurrenceDialog from './CustomRecurrenceDialog';

import { useScheduleForm } from '../hooks/useScheduleForm';
import { EmployeeClassSelectors } from './schedule-form/EmployeeClassSelectors';
import { LocationTimeSelectors } from './schedule-form/LocationTimeSelectors';
import { RecurrenceOptions } from './schedule-form/RecurrenceOptions';

export default function ScheduleForm({ open, onOpenChange, locations, employees, classes, editSchedule, onSaved, onClassCreated }) {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';
  const isAdmin = user?.role === 'admin';

  const {
    form, setForm,
    loading,
    quickClassOpen, setQuickClassOpen,
    customRecurrenceOpen, setCustomRecurrenceOpen,
    customRecurrence, setCustomRecurrence,
    previewConflicts, townToTown, travelChain, outlookOverride,
    handleSubmit, handleDelete,
    handleDateChange, handleRecurrenceChange, handleOverrideChange
  } = useScheduleForm({ open, editSchedule, onSaved, onOpenChange });

  const selectedLocation = locations?.find(l => l.id === form.location_id);
  const selectedClass = classes?.find(c => c.id === form.class_id);

  const handleQuickClassCreated = (classDoc) => {
    onClassCreated?.(classDoc);
    setForm((prev) => ({ ...prev, class_id: classDoc.id }));
  };

  let submitLabel = 'Schedule Class';
  if (loading) submitLabel = 'Saving...';
  else if (outlookOverride) submitLabel = 'Schedule Anyway';
  else if (editSchedule) submitLabel = 'Update Schedule';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-white overflow-y-auto max-h-[90vh]" data-testid="schedule-form-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
            {editSchedule ? 'Edit Schedule' : 'Schedule a Class'}
          </DialogTitle>
          <DialogDescription>
            {editSchedule ? 'Update the class details below.' : 'Assign an employee to a class at a location. Drive time will be automatically calculated.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
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
              className={`${outlookOverride ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'} text-white flex-1`}
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

),
};

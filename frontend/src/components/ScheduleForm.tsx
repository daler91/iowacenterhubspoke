import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { Button } from './ui/button';
import { Trash2, Repeat, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ClassQuickCreateDialog from './ClassQuickCreateDialog';
import CustomRecurrenceDialog from './CustomRecurrenceDialog';
import { schedulesAPI } from '../lib/api';
import { toast } from 'sonner';
import { cn } from '../lib/utils';

import { useScheduleForm } from '../hooks/useScheduleForm';
import { EmployeeClassSelectors } from './schedule-form/EmployeeClassSelectors';
import { LocationTimeSelectors } from './schedule-form/LocationTimeSelectors';
import { RecurrenceOptions } from './schedule-form/RecurrenceOptions';

const STEPS = [
  { label: 'Who & What' },
  { label: 'Where & When' },
  { label: 'Recurrence' },
];

function useEntityMaps(locations: { id: string }[] | undefined, classes: { id: string }[] | undefined) {
  const locationMap = useMemo(() => new Map((locations || []).map(l => [l.id, l])), [locations]);
  const classMap = useMemo(() => new Map((classes || []).map(c => [c.id, c])), [classes]);
  return { locationMap, classMap };
}

function getSubmitLabel(loading: boolean, outlookOverride: boolean, googleOverride: boolean, editSchedule: unknown, employeeCount: number): string {
  if (loading) return 'Saving...';
  if (outlookOverride || googleOverride) return 'Schedule Anyway';
  if (editSchedule) return employeeCount > 1 ? `Update (${employeeCount} Employees)` : 'Update Schedule';
  if (employeeCount > 1) return `Schedule ${employeeCount} Employees`;
  return 'Schedule Class';
}

function stepStyle(i: number, current: number): string {
  if (i === current) return 'bg-hub-soft text-hub-strong';
  if (i < current) return 'bg-spoke-soft text-spoke';
  return 'bg-gray-100 dark:bg-gray-800 text-muted-foreground';
}

function WizardSteps({ step, onStep }: Readonly<{ step: number; onStep: (i: number) => void }>) {
  return (
    <div
      className="flex items-center gap-1"
      data-testid="wizard-steps"
      role="tablist"
      aria-label="Schedule wizard steps"
    >
      {STEPS.map((s, i) => (
        <button
          key={s.label}
          type="button"
          role="tab"
          id={`wizard-step-tab-${i}`}
          aria-selected={i === step}
          aria-controls={`wizard-step-panel-${i}`}
          tabIndex={i === step ? 0 : -1}
          onClick={() => onStep(i)}
          className={cn(
            'flex-1 py-1.5 text-xs font-medium rounded-md transition-colors text-center',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1',
            stepStyle(i, step),
          )}
        >
          Step {i + 1}: {s.label}
        </button>
      ))}
    </div>
  );
}

function firstInvalidFieldId(
  step: number,
  form: { employee_ids: string[]; location_id: string; date: string; start_time: string; end_time: string },
): string | null {
  if (step === 0) {
    if (form.employee_ids.length === 0) return 'schedule-employee-select';
    return null;
  }
  if (step === 1) {
    if (!form.location_id) return 'schedule-location-select';
    if (!form.date) return 'schedule-date-input';
    if (!form.start_time) return 'schedule-start-time';
    if (!form.end_time) return 'schedule-end-time';
    return null;
  }
  return null;
}

function stepInvalidHint(step: number): string {
  if (step === 0) return 'Select at least one employee to continue';
  if (step === 1) return 'Fill location, date, and time to continue';
  return '';
}

const WIZARD_NEXT_HINT_ID = 'wizard-next-invalid-hint';

function WizardNextButton({ step, form, onNext }: Readonly<{
  step: number;
  form: { employee_ids: string[]; location_id: string; date: string; start_time: string; end_time: string };
  onNext: () => void;
}>) {
  // The Next button is disabled until the current step is complete, so
  // users get immediate inline feedback instead of a fire-and-forget
  // toast. The accompanying hint tells them which fields are missing
  // and links to the button via aria-describedby for screen readers.
  const invalidId = firstInvalidFieldId(step, form);
  const disabled = invalidId !== null;
  return (
    <div className="flex-1 flex flex-col items-stretch gap-1">
      <Button
        type="button"
        data-testid="wizard-next-btn"
        onClick={onNext}
        disabled={disabled}
        aria-describedby={disabled ? WIZARD_NEXT_HINT_ID : undefined}
        className="bg-indigo-600 hover:bg-indigo-700 text-white"
      >
        Next <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
      </Button>
      {disabled && (
        <p
          id={WIZARD_NEXT_HINT_ID}
          data-testid="wizard-next-hint"
          className="text-xs text-muted-foreground"
        >
          {stepInvalidHint(step)}
        </p>
      )}
    </div>
  );
}

export default function ScheduleForm({ open, onOpenChange, locations, employees, classes, editSchedule, onSaved, onClassCreated }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'scheduler';
  const isAdmin = user?.role === 'admin';
  const [seriesAction, setSeriesAction] = useState<'this' | 'future'>('this');
  const [showSeriesDeleteConfirm, setShowSeriesDeleteConfirm] = useState(false);
  const hasSeries = !!editSchedule?.series_id;
  const [step, setStep] = useState(0);
  const [seriesDeleteSubmitting, setSeriesDeleteSubmitting] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const isWizard = !editSchedule;
  const totalSteps = isWizard ? STEPS.length : 1;

  // Reset step when dialog opens/closes
  useEffect(() => { if (open) { setStep(0); setDiscardConfirmOpen(false); } }, [open]);

  const {
    form, setForm,
    loading,
    quickClassOpen, setQuickClassOpen,
    customRecurrenceOpen, setCustomRecurrenceOpen,
    customRecurrence, setCustomRecurrence,
    previewConflicts, conflictPreviewError, retryConflictPreview,
    travelChain, outlookOverride, googleOverride,
    handleSubmit, handleDelete,
    handleDateChange, handleRecurrenceChange, handleOverrideChange
  } = useScheduleForm({ open, editSchedule, onSaved, onOpenChange, onProjectPrompt: () => navigate('/coordination/board?create=true') });

  // Map lookups so per-keystroke reads of the selected location/class are
  // O(1) — the .find() variant scaled with the size of the option lists.
  // `Map.get(undefined)` returns undefined, so no extra null guard needed.
  const { locationMap, classMap } = useEntityMaps(locations, classes);
  const selectedLocation = locationMap.get(form.location_id);
  const selectedClass = classMap.get(form.class_id);

  const handleQuickClassCreated = (classDoc) => {
    onClassCreated?.(classDoc);
    setForm((prev) => ({ ...prev, class_id: classDoc.id }));
  };

  const submitLabel = getSubmitLabel(loading, outlookOverride, googleOverride, editSchedule, form.employee_ids?.length || 0);
  const showStep = (s: number) => !isWizard || step === s;
  const showSubmit = !isWizard || step >= totalSteps - 1;
  // Derived from the current form state — no longer driven by "user
  // attempted Next with missing data". Selectors use this to toggle
  // `aria-invalid` so the empty required field is announced and
  // visually flagged as the user works.
  const invalidFieldId = firstInvalidFieldId(step, form);

  // Detecting "dirty" by enumerating specific fields misses edits to
  // date/time/notes/recurrence — users can jump straight to step 2 via
  // the tab strip and change those without touching employee/location/
  // class. Instead snapshot the form JSON shortly after open (one tick,
  // so useScheduleForm's own "reset on open" effect has seeded its
  // defaults) and compare the current form against that baseline on
  // close.
  const [initialFormJson, setInitialFormJson] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setInitialFormJson(null);
      return;
    }
    const id = window.setTimeout(() => setInitialFormJson(JSON.stringify(form)), 0);
    return () => window.clearTimeout(id);
    // form intentionally left out of deps — we snapshot once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (
      !nextOpen
      && isWizard
      && initialFormJson !== null
      && JSON.stringify(form) !== initialFormJson
    ) {
      setDiscardConfirmOpen(true);
      return;
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-white dark:bg-gray-900 overflow-y-auto max-h-[90vh]" data-testid="schedule-form-dialog">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            {editSchedule ? 'Edit Schedule' : 'Schedule a Class'}
          </DialogTitle>
          <DialogDescription>
            {editSchedule ? 'Update the class details below. Add more employees to schedule them for the same class.' : 'Assign one or more employees to a class at a location. Drive time will be automatically calculated.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {isWizard && <WizardSteps step={step} onStep={setStep} />}

          {editSchedule && hasSeries && (
            <fieldset className="flex items-center gap-4 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border">
              <legend className="sr-only">Series edit scope</legend>
              <Repeat className="w-4 h-4 text-hub shrink-0" aria-hidden="true" />
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="seriesAction" value="this" checked={seriesAction === 'this'}
                    onChange={() => setSeriesAction('this')} className="accent-hub" />
                  <span>This schedule only</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="seriesAction" value="future" checked={seriesAction === 'future'}
                    onChange={() => setSeriesAction('future')} className="accent-hub" />
                  <span>All future in series</span>
                </label>
              </div>
            </fieldset>
          )}

          {showStep(0) && (
            <section
              id="wizard-step-panel-0"
              role="tabpanel"
              aria-labelledby="wizard-step-tab-0"
              className="space-y-5"
            >
              <EmployeeClassSelectors
                form={form}
                setForm={setForm}
                employees={employees}
                classes={classes}
                selectedClass={selectedClass}
                onAddClass={isAdmin ? () => setQuickClassOpen(true) : null}
                invalidFieldId={invalidFieldId}
              />
            </section>
          )}

          {showStep(1) && (
            <section
              id="wizard-step-panel-1"
              role="tabpanel"
              aria-labelledby="wizard-step-tab-1"
              className="space-y-5"
            >
              <LocationTimeSelectors
                form={form}
                setForm={setForm}
                locations={locations}
                selectedLocation={selectedLocation}
                onDateChange={handleDateChange}
                previewConflicts={previewConflicts}
                conflictPreviewError={conflictPreviewError}
                onRetryConflictPreview={retryConflictPreview}
                travelChain={travelChain}
                onOverrideChange={handleOverrideChange}
                invalidFieldId={invalidFieldId}
              />
            </section>
          )}

          {!editSchedule && showStep(2) && (
            <section
              id="wizard-step-panel-2"
              role="tabpanel"
              aria-labelledby="wizard-step-tab-2"
              className="space-y-5"
            >
              <RecurrenceOptions
                form={form}
                setForm={setForm}
                customRecurrence={customRecurrence}
                onRecurrenceChange={handleRecurrenceChange}
                openCustomModal={() => setCustomRecurrenceOpen(true)}
              />
            </section>
          )}

          <DialogFooter className="flex gap-2 pt-4">
            {editSchedule && canEdit && (
              <Button
                type="button"
                variant="outline"
                data-testid="schedule-delete-btn"
                onClick={() => hasSeries && seriesAction === 'future' ? setShowSeriesDeleteConfirm(true) : handleDelete()}
                disabled={loading}
                className="text-danger border-danger/30 hover:bg-danger-soft"
              >
                <Trash2 className="w-4 h-4 mr-1" aria-hidden="true" />
                {hasSeries && seriesAction === 'future' ? 'Delete Series' : 'Delete'}
              </Button>
            )}
            {isWizard && step > 0 && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back
              </Button>
            )}
            {showSubmit ? (
              <Button
                type="submit"
                data-testid="schedule-save-btn"
                disabled={loading}
                className={cn(
                  'text-white flex-1',
                  outlookOverride || googleOverride ? 'bg-warn hover:bg-warn/90' : 'bg-indigo-600 hover:bg-indigo-700',
                )}
              >
                {submitLabel}
              </Button>
            ) : (
              <WizardNextButton
                step={step}
                form={form}
                onNext={() => setStep(step + 1)}
              />
            )}
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
          <p className="text-sm text-slate-600 dark:text-muted-foreground">
            This will delete all future schedules in this recurring series. Past schedules will be preserved.
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowSeriesDeleteConfirm(false)}
              disabled={seriesDeleteSubmitting}
            >
              Cancel
            </Button>
            <Button
              className="bg-danger hover:bg-danger/90 text-white"
              disabled={seriesDeleteSubmitting}
              onClick={async () => {
                if (seriesDeleteSubmitting) return;
                setSeriesDeleteSubmitting(true);
                try {
                  await schedulesAPI.deleteSeries(editSchedule.series_id);
                  toast.success('Future schedules in series deleted');
                  setShowSeriesDeleteConfirm(false);
                  onSaved?.();
                  onOpenChange?.(false);
                } catch {
                  toast.error('Failed to delete series');
                } finally {
                  setSeriesDeleteSubmitting(false);
                }
              }}
            >
              {seriesDeleteSubmitting ? 'Deleting…' : 'Delete All Future'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this schedule?</AlertDialogTitle>
            <AlertDialogDescription>
              You've started filling out a new schedule. Closing the dialog will discard your entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="schedule-keep-editing">Keep editing</AlertDialogCancel>
            <AlertDialogAction
              data-testid="schedule-discard-confirm"
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                setDiscardConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { mutate } from 'swr';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import { createDefaultCustomRecurrence } from '../components/CustomRecurrenceDialog';
import type { Schedule } from '../lib/types';

const getDayValue = (dateStr: string) => new Date(`${dateStr}T00:00:00`).getDay();

interface ScheduleFormData {
  employee_id: string;
  employee_ids: string[];
  class_id: string;
  location_id: string;
  date: string;
  start_time: string;
  end_time: string;
  notes: string;
  travel_override_minutes: number | null;
  drive_to_override_minutes: number | null;
  drive_from_override_minutes: number | null;
  recurrence: string;
  recurrence_end_mode: string;
  recurrence_end_date: string;
  recurrence_occurrences: string;
}

interface CustomRecurrence {
  interval: string;
  frequency: string;
  weekdays: number[];
  end_mode: string;
  end_date: string;
  occurrences: string;
}

interface ConflictPreview {
  conflicts: Array<Record<string, unknown>>;
  outlook_conflicts: Array<Record<string, unknown>>;
  google_conflicts: Array<Record<string, unknown>>;
  per_employee?: Record<string, {
    has_conflicts: boolean;
    conflicts: Array<Record<string, unknown>>;
    employee_name?: string;
  }> | null;
}

interface UseScheduleFormProps {
  open: boolean;
  editSchedule: Schedule | null;
  onSaved?: () => void;
  onOpenChange: (open: boolean) => void;
}

export function useScheduleForm({ open, editSchedule, onSaved, onOpenChange }: UseScheduleFormProps) {
  const [form, setForm] = useState<ScheduleFormData>({
    employee_id: '',
    employee_ids: [],
    class_id: '',
    location_id: '',
    date: '',
    start_time: '09:00',
    end_time: '12:00',
    notes: '',
    travel_override_minutes: null,
    drive_to_override_minutes: null,
    drive_from_override_minutes: null,
    recurrence: 'none',
    recurrence_end_mode: 'never',
    recurrence_end_date: '',
    recurrence_occurrences: '',
  });
  const [loading, setLoading] = useState(false);
  const [previewConflicts, setPreviewConflicts] = useState<ConflictPreview>({ conflicts: [], outlook_conflicts: [], google_conflicts: [] });
  const [townToTown, setTownToTown] = useState<Record<string, unknown> | null>(null);
  const [travelChain, setTravelChain] = useState<Record<string, unknown> | null>(null);
  const [outlookOverride, setOutlookOverride] = useState(false);
  const [googleOverride, setGoogleOverride] = useState(false);
  const conflictTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickClassOpen, setQuickClassOpen] = useState(false);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);
  const [customRecurrence, setCustomRecurrence] = useState<CustomRecurrence>(createDefaultCustomRecurrence(new Date().toISOString().split('T')[0]));

  useEffect(() => {
    if (editSchedule) {
      setForm({
        employee_id: editSchedule.employee_id,
        employee_ids: [editSchedule.employee_id],
        class_id: editSchedule.class_id || '',
        location_id: editSchedule.location_id,
        date: editSchedule.date,
        start_time: editSchedule.start_time,
        end_time: editSchedule.end_time,
        notes: editSchedule.notes || '',
        travel_override_minutes: editSchedule.travel_override_minutes || null,
        drive_to_override_minutes: editSchedule.drive_to_override_minutes || editSchedule.travel_override_minutes || null,
        drive_from_override_minutes: editSchedule.drive_from_override_minutes || null,
        recurrence: 'none',
        recurrence_end_mode: 'never',
        recurrence_end_date: '',
        recurrence_occurrences: '',
      });
    } else {
      const startDate = new Date().toISOString().split('T')[0];
      setForm({
        employee_id: '',
        employee_ids: [],
        class_id: '',
        location_id: '',
        date: startDate,
        start_time: '09:00',
        end_time: '12:00',
        notes: '',
        travel_override_minutes: null,
        drive_to_override_minutes: null,
        drive_from_override_minutes: null,
        recurrence: 'none',
        recurrence_end_mode: 'never',
        recurrence_end_date: '',
        recurrence_occurrences: '',
      });
      setCustomRecurrence(createDefaultCustomRecurrence(startDate));
    }
  }, [editSchedule, open]);

  // Debounced conflict preview (fires when key fields change)
  const fetchConflictPreview = useCallback(() => {
    const hasEmployee = editSchedule ? !!form.employee_id : form.employee_ids.length > 0;
    if (!hasEmployee || !form.location_id || !form.date || !form.start_time || !form.end_time) {
      setPreviewConflicts({ conflicts: [], outlook_conflicts: [], google_conflicts: [] });
      setTownToTown(null);
      setTravelChain(null);
      return;
    }
    const payload: Record<string, any> = {
      location_id: form.location_id,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      travel_override_minutes: form.travel_override_minutes ? Number.parseInt(String(form.travel_override_minutes), 10) : null,
      drive_to_override_minutes: form.drive_to_override_minutes ? Number.parseInt(String(form.drive_to_override_minutes), 10) : null,
      drive_from_override_minutes: form.drive_from_override_minutes ? Number.parseInt(String(form.drive_from_override_minutes), 10) : null,
      schedule_id: editSchedule?.id || null,
    };
    if (editSchedule) {
      payload.employee_id = form.employee_id;
    } else {
      payload.employee_ids = form.employee_ids;
    }
    schedulesAPI.checkConflicts(payload)
      .then((res: any) => {
        setPreviewConflicts({
          conflicts: res.data.conflicts || [],
          outlook_conflicts: res.data.outlook_conflicts || [],
          google_conflicts: res.data.google_conflicts || [],
          per_employee: res.data.per_employee || null,
        });
        setTownToTown(res.data.town_to_town || null);
        setTravelChain(res.data.travel_chain || null);
      })
      .catch(() => {
        setPreviewConflicts({ conflicts: [], outlook_conflicts: [], google_conflicts: [] });
        setTownToTown(null);
        setTravelChain(null);
      });
  }, [form.employee_id, form.employee_ids, form.location_id, form.date, form.start_time, form.end_time, form.travel_override_minutes, form.drive_to_override_minutes, form.drive_from_override_minutes, editSchedule]);

  useEffect(() => {
    setOutlookOverride(false);
    setGoogleOverride(false);
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(fetchConflictPreview, 500);
    return () => { if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current); };
  }, [fetchConflictPreview]);

  const validateRecurrence = (): boolean => {
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

    if (form.recurrence_end_mode === 'after_occurrences' && (!form.recurrence_occurrences || Number.parseInt(form.recurrence_occurrences, 10) < 1)) {
      toast.error('Enter a valid number of occurrences');
      return false;
    }
    return true;
  };

  const resolveRecurrenceOccurrences = (isCustom: boolean): number | null => {
    if (isCustom && customRecurrence.end_mode === 'after_occurrences') {
      return Number.parseInt(customRecurrence.occurrences, 10);
    }
    if (form.recurrence_end_mode === 'after_occurrences') {
      return Number.parseInt(form.recurrence_occurrences, 10);
    }
    return null;
  };

  const buildPayload = () => {
    const isCustom = form.recurrence === 'custom';
    const isNone = form.recurrence === 'none';
    const travelMinutes = form.travel_override_minutes ? Number.parseInt(String(form.travel_override_minutes), 10) : null;
    const driveToOverride = form.drive_to_override_minutes ? Number.parseInt(String(form.drive_to_override_minutes), 10) : null;
    const driveFromOverride = form.drive_from_override_minutes ? Number.parseInt(String(form.drive_from_override_minutes), 10) : null;
    const classId = form.class_id || null;
    const payload: Record<string, any> = { ...form, class_id: classId, travel_override_minutes: travelMinutes, drive_to_override_minutes: driveToOverride, drive_from_override_minutes: driveFromOverride };
    // For create mode, send employee_ids; for edit mode, send employee_id
    if (editSchedule) {
      delete payload.employee_ids;
    } else {
      payload.employee_ids = form.employee_ids;
      delete payload.employee_id;
    }

    if (isNone) {
      return { ...payload, recurrence: null, recurrence_end_mode: null, recurrence_end_date: null, recurrence_occurrences: null, custom_recurrence: null };
    }

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
      recurrence_end_mode: isCustom ? customRecurrence.end_mode : form.recurrence_end_mode,
      recurrence_end_date: isCustom ? customRecurrence.end_date : form.recurrence_end_date,
      recurrence_occurrences: resolveRecurrenceOccurrences(isCustom),
      custom_recurrence: customRecurrencePayload,
    };
  };

  const handleCreateResponse = (res: any) => {
    // Multi-employee response
    if (res.data.multi_employee) {
      const created = res.data.total_created || 0;
      const failed = res.data.total_failed || 0;
      if (failed > 0 && created > 0) {
        toast.warning(`${created} scheduled, ${failed} had conflicts`, { duration: 6000 });
      } else if (failed > 0 && created === 0) {
        toast.error(`All ${failed} employees had conflicts`);
      } else {
        toast.success(`${created} employees scheduled successfully`);
      }
      return;
    }
    // Single-employee responses
    if (res.data.background) {
      toast.info(res.data.message);
    } else if (res.data.town_to_town_warning) {
      toast.warning(res.data.town_to_town_warning, { duration: 6000 });
    } else if (res.data.total_created === undefined) {
      toast.success('Class scheduled successfully');
    } else {
      const skipped = res.data.conflicts_skipped?.length || 0;
      const skippedMsg = skipped ? `, ${skipped} skipped (conflicts)` : '';
      toast.success(`${res.data.total_created} classes created${skippedMsg}`);
    }
  };

  const handleConflictError = (err: any) => {
    const detail = err.response.data?.detail || {};
    const outlookConflicts = detail?.outlook_conflicts || [];
    const googleConflicts = detail?.google_conflicts || [];
    const internalConflicts = detail?.conflicts || [];
    if (internalConflicts.length === 0 && (outlookConflicts.length > 0 || googleConflicts.length > 0)) {
      if (outlookConflicts.length > 0) setOutlookOverride(true);
      if (googleConflicts.length > 0) setGoogleOverride(true);
      const sources = [
        outlookConflicts.length > 0 && 'Outlook',
        googleConflicts.length > 0 && 'Google Calendar',
      ].filter(Boolean).join(' and ');
      toast.warning(`Employee has ${sources} conflicts. Click "Schedule anyway" to override.`, { duration: 6000 });
    } else {
      const msg = detail?.message || 'Schedule conflict detected';
      const conflictList = internalConflicts.map((c: any) => `${c.location} (${c.time})`).join(', ');
      toast.error(`${msg}: ${conflictList}`, { duration: 8000 });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasEmployee = editSchedule ? !!form.employee_id : form.employee_ids.length > 0;
    if (!hasEmployee || !form.location_id || !form.date || !form.start_time || !form.end_time) {
      toast.error('Please fill all required fields');
      return;
    }
    if (!editSchedule && !form.class_id) {
      toast.warning('No class type selected — schedule will be created without one.');
    }
    if (!validateRecurrence()) return;

    setLoading(true);
    try {
      const payload = buildPayload();
      if (outlookOverride) payload.force_outlook = true;
      if (googleOverride) payload.force_google = true;
      if (editSchedule) {
        await schedulesAPI.update(editSchedule.id, payload);
        toast.success('Schedule updated');
      } else {
        handleCreateResponse(await schedulesAPI.create(payload));
      }
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      if (err.response?.status === 409) {
        handleConflictError(err);
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
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to delete schedule');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate: string) => {
    setForm(prev => ({ ...prev, date: newDate }));
    setCustomRecurrence(prev => (
      prev.frequency === 'week' && (!prev.weekdays || prev.weekdays.length === 0)
        ? { ...prev, weekdays: [getDayValue(newDate)] }
        : prev
    ));
  };

  const handleRecurrenceChange = (value: string) => {
    setForm(prev => ({
      ...prev,
      recurrence: value,
      recurrence_end_mode: value === 'none' ? 'never' : prev.recurrence_end_mode,
    }));
    if (value === 'custom') {
      setCustomRecurrenceOpen(true);
    }
  };

  const handleOverrideChange = useCallback(async (field: string, minutes: number | null, scheduleId?: string) => {
    const fieldKey = field === 'drive_to' ? 'drive_to_override_minutes' : 'drive_from_override_minutes';
    const currentId = editSchedule?.id || null;

    // If this leg belongs to the current schedule (or new schedule), update local form state
    if (!scheduleId || scheduleId === currentId) {
      setForm(prev => ({ ...prev, [fieldKey]: minutes }));
      return;
    }

    // Cross-schedule override: update the other schedule directly via API
    try {
      await schedulesAPI.update(scheduleId, { [fieldKey]: minutes });
      fetchConflictPreview();
      mutate('schedules'); // Invalidate calendar data so drive blocks update
    } catch {
      // silently fail — chain will show stale data until next refresh
    }
  }, [editSchedule, fetchConflictPreview]);

  return {
    form, setForm,
    loading, setLoading,
    quickClassOpen, setQuickClassOpen,
    customRecurrenceOpen, setCustomRecurrenceOpen,
    customRecurrence, setCustomRecurrence,
    previewConflicts, townToTown, travelChain, outlookOverride, setOutlookOverride, googleOverride, setGoogleOverride,
    handleSubmit, handleDelete,
    handleDateChange, handleRecurrenceChange, handleOverrideChange
  };
}

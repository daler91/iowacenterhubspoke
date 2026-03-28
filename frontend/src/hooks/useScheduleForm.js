import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { schedulesAPI } from '../lib/api';
import { createDefaultCustomRecurrence } from '../components/CustomRecurrenceDialog';

const getDayValue = (dateStr) => new Date(`${dateStr}T00:00:00`).getDay();

export function useScheduleForm({ open, editSchedule, onSaved, onOpenChange }) {
  const [form, setForm] = useState({
    employee_id: '',
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
  const [previewConflicts, setPreviewConflicts] = useState({ conflicts: [], outlook_conflicts: [] });
  const [townToTown, setTownToTown] = useState(null);
  const [travelChain, setTravelChain] = useState(null);
  const [outlookOverride, setOutlookOverride] = useState(false);
  const conflictTimerRef = useRef(null);
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
    if (!form.employee_id || !form.location_id || !form.date || !form.start_time || !form.end_time) {
      setPreviewConflicts({ conflicts: [], outlook_conflicts: [] });
      setTownToTown(null);
      setTravelChain(null);
      return;
    }
    const payload = {
      employee_id: form.employee_id,
      location_id: form.location_id,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      travel_override_minutes: form.travel_override_minutes ? Number.parseInt(form.travel_override_minutes, 10) : null,
      drive_to_override_minutes: form.drive_to_override_minutes ? Number.parseInt(form.drive_to_override_minutes, 10) : null,
      drive_from_override_minutes: form.drive_from_override_minutes ? Number.parseInt(form.drive_from_override_minutes, 10) : null,
      schedule_id: editSchedule?.id || null,
    };
    schedulesAPI.checkConflicts(payload)
      .then(res => {
        setPreviewConflicts({
          conflicts: res.data.conflicts || [],
          outlook_conflicts: res.data.outlook_conflicts || [],
        });
        setTownToTown(res.data.town_to_town || null);
        setTravelChain(res.data.travel_chain || null);
      })
      .catch(() => {
        setPreviewConflicts({ conflicts: [], outlook_conflicts: [] });
        setTownToTown(null);
        setTravelChain(null);
      });
  }, [form.employee_id, form.location_id, form.date, form.start_time, form.end_time, form.travel_override_minutes, form.drive_to_override_minutes, form.drive_from_override_minutes, editSchedule]);

  useEffect(() => {
    setOutlookOverride(false);
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(fetchConflictPreview, 500);
    return () => { if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current); };
  }, [fetchConflictPreview]);

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
    const driveToOverride = form.drive_to_override_minutes ? Number.parseInt(form.drive_to_override_minutes, 10) : null;
    const driveFromOverride = form.drive_from_override_minutes ? Number.parseInt(form.drive_from_override_minutes, 10) : null;
    const classId = form.class_id || null;
    const payload = { ...form, class_id: classId, travel_override_minutes: travelMinutes, drive_to_override_minutes: driveToOverride, drive_from_override_minutes: driveFromOverride };

    if (isNone) {
      return { ...payload, recurrence: null, recurrence_end_mode: null, recurrence_end_date: null, recurrence_occurrences: null, custom_recurrence: null };
    }

    let recurrenceOccurrences = null;
    if (isCustom && customRecurrence.end_mode === 'after_occurrences') {
      recurrenceOccurrences = Number.parseInt(customRecurrence.occurrences, 10);
    } else if (form.recurrence_end_mode === 'after_occurrences') {
      recurrenceOccurrences = Number.parseInt(form.recurrence_occurrences, 10);
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
      recurrence_occurrences: recurrenceOccurrences,
      custom_recurrence: customRecurrencePayload,
    };
  };

  const handleCreateResponse = (res) => {
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

  const handleConflictError = (err) => {
    const detail = err.response.data?.detail || {};
    const outlookConflicts = detail?.outlook_conflicts || [];
    const internalConflicts = detail?.conflicts || [];
    if (outlookConflicts.length > 0 && internalConflicts.length === 0) {
      setOutlookOverride(true);
      toast.warning('Employee has Outlook calendar conflicts. Click "Schedule anyway" to override.', { duration: 6000 });
    } else {
      const msg = detail?.message || 'Schedule conflict detected';
      const conflictList = internalConflicts.map(c => `${c.location} (${c.time})`).join(', ');
      toast.error(`${msg}: ${conflictList}`, { duration: 8000 });
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
    if (!validateRecurrence()) return;

    setLoading(true);
    try {
      const payload = buildPayload();
      if (outlookOverride) payload.force_outlook = true;
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
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to delete schedule');
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (newDate) => {
    setForm(prev => ({ ...prev, date: newDate }));
    setCustomRecurrence(prev => (
      prev.frequency === 'week' && (!prev.weekdays || prev.weekdays.length === 0)
        ? { ...prev, weekdays: [getDayValue(newDate)] }
        : prev
    ));
  };

  const handleRecurrenceChange = (value) => {
    setForm(prev => ({
      ...prev,
      recurrence: value,
      recurrence_end_mode: value === 'none' ? 'never' : prev.recurrence_end_mode,
    }));
    if (value === 'custom') {
      setCustomRecurrenceOpen(true);
    }
  };

  const handleOverrideChange = useCallback((field, minutes) => {
    if (field === 'drive_to') {
      setForm(prev => ({ ...prev, drive_to_override_minutes: minutes }));
    } else if (field === 'drive_from') {
      setForm(prev => ({ ...prev, drive_from_override_minutes: minutes }));
    }
  }, []);

  return {
    form, setForm,
    loading, setLoading,
    quickClassOpen, setQuickClassOpen,
    customRecurrenceOpen, setCustomRecurrenceOpen,
    customRecurrence, setCustomRecurrence,
    previewConflicts, townToTown, travelChain, outlookOverride, setOutlookOverride,
    handleSubmit, handleDelete,
    handleDateChange, handleRecurrenceChange, handleOverrideChange
  };
}

import { useState } from 'react';
import type { Schedule } from '../lib/types';

export function useScheduleModal() {
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const handleNewSchedule = () => {
    setEditingSchedule(null);
    setScheduleFormOpen(true);
  };

  const handleEditSchedule = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setScheduleFormOpen(true);
  };

  return {
    scheduleFormOpen,
    setScheduleFormOpen,
    editingSchedule,
    handleNewSchedule,
    handleEditSchedule
  };
}

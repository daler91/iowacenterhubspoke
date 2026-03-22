import { useState } from 'react';

export function useScheduleModal() {
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);

  const handleNewSchedule = () => {
    setEditingSchedule(null);
    setScheduleFormOpen(true);
  };

  const handleEditSchedule = (schedule) => {
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

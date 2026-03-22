import { useState } from 'react';
import { format } from 'date-fns';

export function useStatModal({ schedules = [], employees = [], locations = [] }) {
  const [statModalOpen, setStatModalOpen] = useState(false);
  const [statModalType, setStatModalType] = useState('today');
  const [statModalData, setStatModalData] = useState([]);
  const [statModalTitle, setStatModalTitle] = useState('');

  const handleStatClick = (type) => {
    setStatModalType(type);

    if (type === 'today') {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const todaySchedules = (schedules || []).filter(s => s.date === todayStr);
      setStatModalData(todaySchedules);
      setStatModalTitle('Today\'s Schedule');
    } else if (type === 'scheduled') {
      const futureSchedules = (schedules || []).filter(s => new Date(s.date) >= new Date(new Date().setHours(0,0,0,0)));
      futureSchedules.sort((a, b) => new Date(a.date) - new Date(b.date));
      setStatModalData(futureSchedules);
      setStatModalTitle('All Scheduled Classes');
    } else if (type === 'team') {
      setStatModalData(employees || []);
      setStatModalTitle('Team Members');
    } else if (type === 'locations') {
      setStatModalData(locations || []);
      setStatModalTitle('All Locations');
    }

    setStatModalOpen(true);
  };

  return {
    statModalOpen,
    setStatModalOpen,
    statModalType,
    statModalData,
    statModalTitle,
    handleStatClick
  };
}

import { useState } from 'react';
import { format } from 'date-fns';
import type { Schedule, Employee, Location, ClassType } from '../lib/types';

type StatType = 'today' | 'scheduled' | 'team' | 'locations' | 'classes';

interface UseStatModalProps {
  schedules?: Schedule[];
  employees?: Employee[];
  locations?: Location[];
  classes?: ClassType[];
}

export function useStatModal({ schedules = [], employees = [], locations = [], classes = [] }: UseStatModalProps) {
  const [statModalOpen, setStatModalOpen] = useState(false);
  const [statModalType, setStatModalType] = useState<StatType>('today');
  const [statModalData, setStatModalData] = useState<(Schedule | Employee | Location)[]>([]);
  const [statModalTitle, setStatModalTitle] = useState('');

  const handleStatClick = (type: StatType) => {
    setStatModalType(type);

    if (type === 'today') {
      const today = new Date();
      const todayStr = format(today, 'yyyy-MM-dd');
      const todaySchedules = (schedules || []).filter(s => s.date === todayStr);
      setStatModalData(todaySchedules);
      setStatModalTitle('Today\'s Schedule');
    } else if (type === 'scheduled') {
      const futureSchedules = (schedules || []).filter(s => new Date(s.date) >= new Date(new Date().setHours(0,0,0,0)));
      futureSchedules.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setStatModalData(futureSchedules);
      setStatModalTitle('All Scheduled Classes');
    } else if (type === 'team') {
      setStatModalData(employees || []);
      setStatModalTitle('Team Members');
    } else if (type === 'locations') {
      setStatModalData(locations || []);
      setStatModalTitle('All Locations');
    } else if (type === 'classes') {
      setStatModalData(classes || []);
      setStatModalTitle('All Class Types');
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

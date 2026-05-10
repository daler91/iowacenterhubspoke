import { useState } from 'react';
import { getCalendarDateKey, getLocalCalendarDateKey } from '../lib/date-format';
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
      const todayStr = getLocalCalendarDateKey();
      const todaySchedules = (schedules || []).filter(s => s.date === todayStr);
      setStatModalData(todaySchedules);
      setStatModalTitle('Today\'s Schedule');
    } else if (type === 'scheduled') {
      const todayStr = getLocalCalendarDateKey();
      const futureSchedules = (schedules || []).filter(s => {
        const scheduleDateKey = getCalendarDateKey(s.date);
        return scheduleDateKey !== null && scheduleDateKey >= todayStr;
      });
      futureSchedules.sort((a, b) =>
        (getCalendarDateKey(a.date) ?? '').localeCompare(getCalendarDateKey(b.date) ?? ''));
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

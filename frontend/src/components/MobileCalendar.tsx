import React, { useState } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { Car, AlertTriangle, ChevronLeft, ChevronRight, Clock, MapPin, User, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { COLORS } from '../lib/constants';

// Use embla-carousel-react for swipeable day view
import useEmblaCarousel from 'embla-carousel-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from './ui/drawer';
import { Button } from './ui/button';

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

export default function MobileCalendar({ currentDate, schedules, onEditSchedule, setCurrentDate, selectionMode, isSelected, toggleItem }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, startIndex: 1 });
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // We want to show previous day, current day, next day
  const days = [
    subDays(currentDate, 1),
    currentDate,
    addDays(currentDate, 1),
  ];

  // When swipe happens, update currentDate
  React.useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const index = emblaApi.selectedScrollSnap();
      if (index === 0) {
        setCurrentDate(subDays(currentDate, 1));
        emblaApi.scrollTo(1, true); // reset to middle
      } else if (index === 2) {
        setCurrentDate(addDays(currentDate, 1));
        emblaApi.scrollTo(1, true); // reset to middle
      }
    };
    emblaApi.on('select', onSelect);
    return () => emblaApi.off('select', onSelect);
  }, [emblaApi, currentDate, setCurrentDate]);

  const handleScheduleClick = (schedule) => {
    if (selectionMode) {
      toggleItem?.(schedule.id);
    } else {
      setSelectedSchedule(schedule);
      setIsDrawerOpen(true);
    }
  };

  const renderDay = (date, index) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    let daySchedules = (schedules || []).filter(s => s.date === dateStr);

    // Sort schedules by start time
    daySchedules.sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    return (
      <div className="flex-[0_0_100%] min-w-0" key={index}>
        <div className="px-4 py-2">
          {daySchedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500">
              <Clock className="w-12 h-12 mb-3 opacity-20" />
              <p>No classes scheduled for today.</p>
            </div>
          ) : (
            <div className="space-y-3 pb-24">
              {daySchedules.map(schedule => {
                const classColor = schedule.class_color || schedule.employees?.[0]?.color || COLORS.DEFAULT_CLASS;
                const className = schedule.class_name || 'Unassigned Class';
                const selected = selectionMode && isSelected?.(schedule.id);

                return (
                  <div key={schedule.id} className="relative">
                    <button
                      type="button"
                      className={cn(
                        "w-full text-left bg-white rounded-xl p-4 shadow-sm border border-gray-100 transition-all",
                        selectionMode ? "cursor-pointer" : "cursor-pointer active:scale-[0.98]",
                        selected && "ring-2 ring-indigo-500 border-transparent"
                      )}
                      style={{ borderLeftColor: classColor, borderLeftWidth: '4px' }}
                      onClick={() => handleScheduleClick(schedule)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2">
                          {selectionMode && (
                            <div className={cn(
                              "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0",
                              selected ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                            )}>
                              {selected && <Check className="w-3.5 h-3.5 text-white" />}
                            </div>
                          )}
                          <h3 className="font-semibold text-slate-800">{className}</h3>
                        </div>
                        <span className="text-sm font-medium text-slate-600 shrink-0 bg-slate-50 px-2 py-1 rounded-md">
                          {schedule.start_time} - {schedule.end_time}
                        </span>
                      </div>

                      <div className="space-y-1.5 mt-3">
                        <div className="flex items-center text-sm text-slate-600">
                          <MapPin className="w-4 h-4 mr-2 opacity-70" />
                          <span className="truncate">{schedule.location_name}</span>
                        </div>
                        <div className="flex items-center text-sm text-slate-600">
                          <User className="w-4 h-4 mr-2 opacity-70" />
                          <span className="truncate">{schedule.employees?.map(e => e.name).join(', ') || 'Unassigned'}</span>
                        </div>
                      </div>

                      {schedule.town_to_town && (
                        <div className="mt-3 flex items-center gap-1.5 text-amber-600 text-xs font-medium bg-amber-50 px-2 py-1.5 rounded-md">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Town-to-Town Travel Detected
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mobile-calendar flex flex-col h-full bg-slate-50/50 -mx-4 sm:mx-0">
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setCurrentDate(subDays(currentDate, 1))}
          className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-0.5">
            {format(currentDate, 'EEEE')}
          </p>
          <h2 className="text-lg font-bold text-slate-800 leading-none">
            {format(currentDate, 'MMMM d, yyyy')}
          </h2>
        </div>

        <button
          onClick={() => setCurrentDate(addDays(currentDate, 1))}
          className="p-2 -mr-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="overflow-hidden flex-1" ref={emblaRef}>
        <div className="flex h-full">
          {days.map((date, index) => renderDay(date, index))}
        </div>
      </div>

      {/* Bottom Sheet for Details */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="bg-white">
          {selectedSchedule && (
            <div className="mx-auto w-full max-w-sm">
              <DrawerHeader className="text-left px-6 pt-6 pb-2">
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: selectedSchedule.class_color || selectedSchedule.employees?.[0]?.color || COLORS.DEFAULT_CLASS }}
                  />
                  <DrawerTitle className="text-xl">{selectedSchedule.class_name || 'Unassigned Class'}</DrawerTitle>
                </div>
                <DrawerDescription className="text-base text-slate-600 flex items-center gap-2 mt-2">
                  <Clock className="w-4 h-4" />
                  {format(parseISO(selectedSchedule.date), 'MMM d, yyyy')} • {selectedSchedule.start_time} - {selectedSchedule.end_time}
                </DrawerDescription>
              </DrawerHeader>

              <div className="p-6 space-y-4">
                <div className="bg-slate-50 p-4 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Location</p>
                      <p className="text-sm text-slate-600">{selectedSchedule.location_name}</p>
                    </div>
                  </div>

                  <div className="w-full h-px bg-slate-200 ml-8" />

                  <div className="flex items-start gap-3">
                    <User className="w-5 h-5 text-slate-400 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">Instructor</p>
                      <p className="text-sm text-slate-600">{selectedSchedule.employees?.map(e => e.name).join(', ') || 'Unassigned'}</p>
                    </div>
                  </div>
                </div>

                {selectedSchedule.drive_time_minutes > 0 && (
                  <div className="flex items-center gap-2 text-sm text-slate-600 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                    <Car className="w-4 h-4 text-indigo-600" />
                    <span>Est. Drive Time: <span className="font-semibold text-indigo-700">{selectedSchedule.drive_time_minutes} min</span></span>
                  </div>
                )}

                {selectedSchedule.town_to_town && (
                  <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
                    <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600" />
                    <p><strong>Warning:</strong> Back-to-back classes in different towns detected. Travel time may overlap with class time.</p>
                  </div>
                )}
              </div>

              <DrawerFooter className="pt-2 pb-6 px-6 flex-row gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setIsDrawerOpen(false)}
                >
                  Close
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    setIsDrawerOpen(false);
                    onEditSchedule?.(selectedSchedule);
                  }}
                >
                  Edit Details
                </Button>
              </DrawerFooter>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}


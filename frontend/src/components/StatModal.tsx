import { useMemo } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { Badge } from './ui/badge';
import { Users, MapPin, Clock, BookOpen } from 'lucide-react';
import { EntityLink } from './ui/entity-link';

const UNKNOWN_CLASS = { name: 'Unknown Class', color: '#ccc' };
const UNKNOWN_LOCATION = { city_name: 'Unknown Location' };

export default function StatModal({ isOpen, onClose, title, type, data, classes, employees, locations }) {
  const classMap = useMemo(() => {
    const m = new Map();
    (classes || []).forEach(c => m.set(c.id, c));
    return m;
  }, [classes]);
  const locationMap = useMemo(() => {
    const m = new Map();
    (locations || []).forEach(l => m.set(l.id, l));
    return m;
  }, [locations]);

  if (!isOpen) return null;

  const getClassById = (id) => classMap.get(id) || UNKNOWN_CLASS;
  const getLocationById = (id) => locationMap.get(id) || UNKNOWN_LOCATION;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {type === 'today' && `Schedules for today (${data.length})`}
            {type === 'scheduled' && `All upcoming schedules (${data.length})`}
            {type === 'team' && `All team members (${data.length})`}
            {type === 'locations' && `All locations (${data.length})`}
            {type === 'classes' && `All class types (${data.length})`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 relative min-h-0">
          <div
            aria-label={title}
            className="absolute inset-0 overflow-y-auto py-4 pr-2 space-y-3"
          >
          {(type === 'today' || type === 'scheduled') && (
            data.length > 0 ? (
              data.map((schedule) => {
                const classLookup = getClassById(schedule.class_id);
                const hasKnownName = classLookup.name === 'Unknown Class';
                const hasKnownColor = classLookup.color === '#ccc';
                const displayClass = {
                  name: hasKnownName ? (schedule.class_name || 'Unknown Class') : classLookup.name,
                  color: hasKnownColor ? (schedule.class_color || '#ccc') : classLookup.color,
                };
                const location = getLocationById(schedule.location_id);
                const isToday = type === 'today';
                const dateText = isToday ? 'Today' : format(new Date(schedule.date), 'MMM d, yyyy');

                return (
                  <div key={schedule.id} className="flex flex-col p-4 border rounded-lg hover:bg-muted/50 dark:hover:bg-muted transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: displayClass.color }} />
                        <span className="font-semibold text-foreground">{displayClass.name}</span>
                      </div>
                      <Badge variant="outline" className="text-xs bg-muted/50 dark:bg-muted">
                        {dateText}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-foreground/80 dark:text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span>{schedule.start_time} - {schedule.end_time}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        {schedule.employees?.length > 0 ? (
                          schedule.employees.map((emp, i) => (
                            <span key={emp.id}>
                              <EntityLink type="employee" id={emp.id} className="text-foreground/80 dark:text-muted-foreground">{emp.name}</EntityLink>
                              {i < schedule.employees.length - 1 && ', '}
                            </span>
                          ))
                        ) : (
                          <span className="text-foreground/80 dark:text-muted-foreground">Unassigned</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <EntityLink type="location" id={schedule.location_id} className="text-foreground/80 dark:text-muted-foreground">{location.city_name}</EntityLink>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8 text-foreground/80 dark:text-muted-foreground">No schedules found.</div>
            )
          )}

          {type === 'team' && (
            data.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.map((emp) => (
                  <div key={emp.id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 dark:hover:bg-muted transition-colors">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-medium" style={{ backgroundColor: emp.color }}>
                      {(emp.name || '?').charAt(0)}
                    </div>
                    <div>
                      <EntityLink type="employee" id={emp.id} className="font-medium text-foreground">{emp.name || 'Unknown'}</EntityLink>
                      {emp.email && <div className="text-xs text-foreground/80 dark:text-muted-foreground">{emp.email}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-foreground/80 dark:text-muted-foreground">No team members found.</div>
            )
          )}

          {type === 'locations' && (
            data.length > 0 ? (
              <div className="grid grid-cols-1 gap-3">
                {data.map((loc) => (
                  <div key={loc.id} className="flex items-start gap-3 p-4 border rounded-lg hover:bg-muted/50 dark:hover:bg-muted transition-colors">
                    <div className="w-10 h-10 bg-warn-soft rounded-lg flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-warn-strong" />
                    </div>
                    <div>
                      <EntityLink type="location" id={loc.id} className="font-medium text-foreground">{loc.city_name}</EntityLink>
                      <div className="text-sm text-foreground/80 dark:text-muted-foreground mt-1 line-clamp-2">{loc.address}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-foreground/80 dark:text-muted-foreground">No locations found.</div>
            )
          )}

          {type === 'classes' && (
            data.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.map((classItem) => (
                  <div key={classItem.id} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 dark:hover:bg-muted transition-colors">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: classItem.color || '#0F766E' }}>
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <EntityLink type="class" id={classItem.id} className="font-medium text-foreground">{classItem.name}</EntityLink>
                      <div className="text-xs text-foreground/80 dark:text-muted-foreground mt-1 break-words">{classItem.description || 'No description'}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-foreground/80 dark:text-muted-foreground">No class types found.</div>
            )
          )}
          </div>
          {/* Decorative fade hints at more content below when the list
              scrolls. pointer-events-none so it never blocks clicks on
              items near the bottom. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 right-2 h-6 bg-gradient-to-t from-background to-transparent"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}


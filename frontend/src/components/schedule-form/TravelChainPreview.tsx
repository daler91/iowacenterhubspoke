import { useState, useRef } from 'react';
import { Car, ArrowDown, Pencil, RotateCcw } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { cn } from '../../lib/utils';

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function DriveTimePill({ leg, onOverrideChange }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  const canEdit = !!onOverrideChange;
  const field = leg.override_field;

  const handleApply = () => {
    const parsed = Number.parseInt(value, 10);
    if (parsed > 0) {
      onOverrideChange(field, parsed, leg.owner_schedule_id);
    }
    setOpen(false);
    setValue('');
  };

  const handleReset = () => {
    onOverrideChange(field, null, leg.owner_schedule_id);
    setOpen(false);
    setValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleApply();
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setValue('');
    }
  };

  // Non-editable: plain text
  if (!canEdit) {
    return (
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {leg.minutes} min
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setValue(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Override drive time (currently ${leg.minutes} minutes${leg.is_overridden ? ', manually overridden' : ''})`}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hub focus-visible:ring-offset-1",
            leg.is_overridden
              ? "bg-info-soft text-info border-info/30 hover:bg-info-soft/70"
              : "bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-gray-700 hover:bg-slate-200 dark:hover:bg-gray-700"
          )}
        >
          {leg.minutes} min
          <Pencil className="w-3 h-3 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-56 p-3 space-y-3"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor="override-drive-time" className="text-xs font-medium text-slate-700 dark:text-gray-200">
            Override drive time
          </label>
          <Input
            id="override-drive-time"
            ref={inputRef}
            type="number"
            min="1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`${leg.minutes} min`}
            className="h-9 w-full"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={!value || Number.parseInt(value, 10) <= 0}
            className="flex-1"
          >
            Apply
          </Button>
          {leg.is_overridden && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="text-slate-600 dark:text-gray-400"
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}


export function TravelChainPreview({ travelChain, onOverrideChange }) {
  if (!travelChain || travelChain.class_count < 1) return null;

  const { legs, total_drive_minutes } = travelChain;

  return (
    <div className="p-3 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-slate-600 dark:text-gray-300" />
          <span className="text-xs font-semibold text-slate-700 dark:text-gray-200">Day Travel Plan</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-slate-200 dark:bg-gray-700 text-slate-700 dark:text-gray-200">
          {formatDuration(total_drive_minutes)} total drive
        </Badge>
      </div>

      {/* Timeline */}
      <div className="relative pl-4">
        {legs.map((leg, i) => {
          if (leg.type === 'drive') {
            const isFirst = i === 0;
            const isLast = i === legs.length - 1;
            const isHub = isFirst || isLast;
            const isSameCity = leg.minutes === 0 && !isHub && !leg.is_overridden;

            return (
              <div key={`drive-${leg.from_label}-${leg.to_label}`} className="flex items-stretch">
                {/* Vertical line + node */}
                <div className="flex flex-col items-center mr-3 relative" style={{ width: '12px' }}>
                  {isHub && (
                    <div className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-indigo-300 z-10 shrink-0" />
                  )}
                  {!isLast && (
                    <div className={cn(
                      "w-0 border-l-2 border-dashed flex-1",
                      isSameCity ? "border-slate-200 min-h-[16px]" : "border-slate-300 min-h-[28px]"
                    )} />
                  )}
                </div>

                {/* Label */}
                <div className={cn("pb-1 flex items-center gap-2 flex-wrap", isHub ? "pt-0" : "pt-1")}>
                  {isHub && (
                    <>
                      <span className="text-[11px] font-medium text-indigo-600">
                        {isFirst ? leg.from_label : leg.to_label}
                        {isFirst && leg.start_time && (
                          <span className="text-[10px] text-muted-foreground font-normal ml-1">
                            depart {leg.start_time}
                          </span>
                        )}
                        {isLast && leg.end_time && (
                          <span className="text-[10px] text-muted-foreground font-normal ml-1">
                            arrive {leg.end_time}
                          </span>
                        )}
                      </span>
                      <DriveTimePill leg={leg} onOverrideChange={onOverrideChange} />
                    </>
                  )}
                  {!isHub && !isSameCity && (
                    <>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <ArrowDown className="w-3 h-3" />
                        {leg.start_time && leg.end_time ? `${leg.start_time}–${leg.end_time}` : ''}
                      </span>
                      <DriveTimePill leg={leg} onOverrideChange={onOverrideChange} />
                    </>
                  )}
                  {isSameCity && (
                    <span className="text-[10px] text-muted-foreground italic">Same city</span>
                  )}
                </div>
              </div>
            );
          }

          // Class leg
          return (
            <div key={`class-${leg.owner_schedule_id}`} className="flex items-stretch">
              <div className="flex flex-col items-center mr-3 relative" style={{ width: '12px' }}>
                <div className={cn(
                  "w-3 h-3 rounded-full border-2 z-10 shrink-0",
                  leg.is_current
                    ? "bg-teal-500 border-teal-300"
                    : "bg-slate-400 border-slate-300"
                )} />
                {i < legs.length - 1 && (
                  <div className="w-0 border-l-2 border-dashed border-slate-300 flex-1 min-h-[8px]" />
                )}
              </div>

              <div className={cn(
                "pb-2 -mt-0.5 rounded px-2 py-1",
                leg.is_current && "bg-teal-50 border border-teal-200"
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs font-medium",
                    leg.is_current ? "text-teal-700" : "text-slate-700 dark:text-gray-200"
                  )}>
                    {leg.location_name}
                  </span>
                  {leg.is_current && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-teal-100 text-teal-600">
                      current
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {leg.start_time} – {leg.end_time}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

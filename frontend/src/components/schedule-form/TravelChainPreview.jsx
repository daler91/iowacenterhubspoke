import PropTypes from 'prop-types';
import { Car, ArrowDown } from 'lucide-react';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function TravelChainPreview({ travelChain }) {
  if (!travelChain || travelChain.class_count < 2) return null;

  const { legs, total_drive_minutes } = travelChain;

  return (
    <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-slate-600" />
          <span className="text-xs font-semibold text-slate-700">Day Travel Plan</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-slate-200 text-slate-700">
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
            const isSameCity = leg.minutes === 0 && !isHub;

            return (
              <div key={`drive-${i}`} className="flex items-stretch">
                {/* Vertical line + node */}
                <div className="flex flex-col items-center mr-3 relative" style={{ width: '12px' }}>
                  {/* Hub or connector dot */}
                  {isHub && (
                    <div className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-indigo-300 z-10 shrink-0" />
                  )}
                  {/* Dashed connector line */}
                  {!isLast && (
                    <div className={cn(
                      "w-0 border-l-2 border-dashed flex-1",
                      isSameCity ? "border-slate-200 min-h-[16px]" : "border-slate-300 min-h-[28px]"
                    )} />
                  )}
                </div>

                {/* Label */}
                <div className={cn("pb-1 flex items-center gap-1.5", isHub ? "pt-0" : "pt-1")}>
                  {isHub && (
                    <span className="text-[11px] font-medium text-indigo-600">
                      {isFirst ? leg.from_label : leg.to_label}
                    </span>
                  )}
                  {!isHub && !isSameCity && (
                    <span className="text-[10px] text-slate-400 flex items-center gap-1">
                      <ArrowDown className="w-3 h-3" />
                      {leg.minutes} min drive
                    </span>
                  )}
                  {isSameCity && (
                    <span className="text-[10px] text-slate-300 italic">Same city</span>
                  )}
                  {isHub && leg.minutes > 0 && (
                    <span className="text-[10px] text-slate-400">
                      ({leg.minutes} min)
                    </span>
                  )}
                </div>
              </div>
            );
          }

          // Class leg
          return (
            <div key={`class-${i}`} className="flex items-stretch">
              {/* Node + line */}
              <div className="flex flex-col items-center mr-3 relative" style={{ width: '12px' }}>
                <div className={cn(
                  "w-3 h-3 rounded-full border-2 z-10 shrink-0",
                  leg.is_current
                    ? "bg-teal-500 border-teal-300"
                    : "bg-slate-400 border-slate-300"
                )} />
                {/* Line continues if not last leg */}
                {i < legs.length - 1 && (
                  <div className="w-0 border-l-2 border-dashed border-slate-300 flex-1 min-h-[8px]" />
                )}
              </div>

              {/* Class info */}
              <div className={cn(
                "pb-2 -mt-0.5 rounded px-2 py-1",
                leg.is_current && "bg-teal-50 border border-teal-200"
              )}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs font-medium",
                    leg.is_current ? "text-teal-700" : "text-slate-700"
                  )}>
                    {leg.location_name}
                  </span>
                  {leg.is_current && (
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-teal-100 text-teal-600">
                      current
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-slate-400">
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

TravelChainPreview.propTypes = {
  travelChain: PropTypes.shape({
    legs: PropTypes.arrayOf(
      PropTypes.shape({
        type: PropTypes.oneOf(['drive', 'class']).isRequired,
        from_label: PropTypes.string,
        to_label: PropTypes.string,
        minutes: PropTypes.number,
        location_name: PropTypes.string,
        start_time: PropTypes.string,
        end_time: PropTypes.string,
        is_current: PropTypes.bool,
      })
    ),
    total_drive_minutes: PropTypes.number,
    class_count: PropTypes.number,
  }),
};

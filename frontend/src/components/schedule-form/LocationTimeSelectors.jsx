import PropTypes from 'prop-types';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { MapPin, Car, Clock, AlertTriangle, Calendar } from 'lucide-react';

const OUTLOOK_STATUS_LABELS = { busy: 'Busy', tentative: 'Tentative', oof: 'Out of Office' };
const OUTLOOK_STATUS_COLORS = { busy: 'bg-red-100 text-red-700', tentative: 'bg-amber-100 text-amber-700', oof: 'bg-purple-100 text-purple-700' };

function formatOutlookTime(dateTime) {
  if (!dateTime) return '';
  const t = dateTime.includes('T') ? dateTime.split('T')[1] : dateTime;
  return t.substring(0, 5);
}

export function LocationTimeSelectors({
  form, setForm,
  locations, selectedLocation,
  showOverride, setShowOverride,
  onDateChange,
  previewConflicts,
}) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">Location</Label>
        <Select value={form.location_id} onValueChange={(v) => setForm({ ...form, location_id: v })}>
          <SelectTrigger data-testid="schedule-location-select" className="h-10 bg-gray-50/50">
            <SelectValue placeholder="Select a location" />
          </SelectTrigger>
          <SelectContent>
            {(locations || []).map(loc => (
              <SelectItem key={loc.id} value={loc.id}>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-teal-600" />
                  {loc.city_name}
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600">
                    {loc.drive_time_minutes}m
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedLocation && (
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
            <Car className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-500">
              Estimated drive: <span className="font-semibold text-slate-700">{selectedLocation.drive_time_minutes} min</span> each way from Hub
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-700">Date</Label>
          <Input
            type="date"
            data-testid="schedule-date-input"
            value={form.date}
            onChange={(e) => onDateChange(e.target.value)}
            className="h-10 bg-gray-50/50"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-700">Start Time</Label>
          <Input
            type="time"
            data-testid="schedule-start-time"
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            className="h-10 bg-gray-50/50"
            required
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-slate-700">End Time</Label>
          <Input
            type="time"
            data-testid="schedule-end-time"
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            className="h-10 bg-gray-50/50"
            required
          />
        </div>
      </div>

      {/* Outlook calendar conflict preview */}
      {previewConflicts?.outlook_conflicts?.length > 0 && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2" data-testid="outlook-conflict-banner">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-semibold text-blue-700">
              Outlook Calendar Conflicts
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewConflicts.outlook_conflicts.map((c, i) => (
              <Badge
                key={i}
                variant="secondary"
                className={`text-[10px] px-2 py-0.5 ${OUTLOOK_STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-700'}`}
              >
                {OUTLOOK_STATUS_LABELS[c.status] || c.status} {formatOutlookTime(c.start)}–{formatOutlookTime(c.end)}
              </Badge>
            ))}
          </div>
          <p className="text-[11px] text-blue-600">
            This employee has Outlook calendar conflicts during this time.
          </p>
        </div>
      )}

      {/* Internal schedule conflict preview */}
      {previewConflicts?.conflicts?.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2" data-testid="internal-conflict-banner">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-semibold text-amber-700">
              Schedule Conflicts
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {previewConflicts.conflicts.map((c, i) => (
              <Badge key={i} variant="secondary" className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700">
                {c.location} ({c.time})
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          data-testid="toggle-travel-override"
          onClick={() => setShowOverride(!showOverride)}
          className="text-xs text-indigo-600 font-medium hover:text-indigo-700 flex items-center gap-1"
        >
          <Clock className="w-3 h-3" />
          {showOverride ? 'Hide' : 'Override'} travel time
        </button>
        {showOverride && (
          <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-semibold text-amber-700">
                Town-to-Town Travel: Verify drive time manually
              </span>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-amber-700">Override drive time (minutes)</Label>
              <Input
                type="number"
                data-testid="travel-override-input"
                placeholder="e.g. 45"
                value={form.travel_override_minutes || ''}
                onChange={(e) => setForm({ ...form, travel_override_minutes: e.target.value })}
                className="h-9 bg-white"
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-slate-700">Notes (optional)</Label>
        <Input
          data-testid="schedule-notes-input"
          placeholder="Additional notes..."
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="h-10 bg-gray-50/50"
        />
      </div>
    </>
  );
}

LocationTimeSelectors.propTypes = {
  form: PropTypes.shape({
    location_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    date: PropTypes.string,
    start_time: PropTypes.string,
    end_time: PropTypes.string,
    travel_override_minutes: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    notes: PropTypes.string,
  }).isRequired,
  setForm: PropTypes.func.isRequired,
  locations: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    city_name: PropTypes.string.isRequired,
    drive_time_minutes: PropTypes.number,
  })),
  selectedLocation: PropTypes.shape({
    drive_time_minutes: PropTypes.number,
  }),
  showOverride: PropTypes.bool.isRequired,
  setShowOverride: PropTypes.func.isRequired,
  onDateChange: PropTypes.func.isRequired,
};

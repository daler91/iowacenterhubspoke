import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { MapPin, Car, AlertTriangle, Calendar, WifiOff, RefreshCw } from 'lucide-react';
import { TravelChainPreview } from './TravelChainPreview';
import { RequiredMark } from './RequiredMark';

const OUTLOOK_STATUS_LABELS = { busy: 'Busy', tentative: 'Tentative', oof: 'Out of Office' };
const OUTLOOK_STATUS_COLORS = {
  busy: 'bg-danger-soft text-danger-strong',
  tentative: 'bg-warn-soft text-warn-strong',
  oof: 'bg-ownership-partner-soft text-ownership-partner-strong',
};

function formatOutlookTime(dateTime) {
  if (!dateTime) return '';
  const t = dateTime.includes('T') ? dateTime.split('T')[1] : dateTime;
  return t.substring(0, 5);
}

export function LocationTimeSelectors({
  form, setForm,
  locations, selectedLocation,
  onDateChange,
  previewConflicts,
  conflictPreviewError,
  onRetryConflictPreview,
  travelChain,
  onOverrideChange,
  invalidFieldId,
}) {
  const hasConflicts =
    (previewConflicts?.outlook_conflicts?.length ?? 0) > 0 ||
    (previewConflicts?.google_conflicts?.length ?? 0) > 0 ||
    (previewConflicts?.conflicts?.length ?? 0) > 0;
  const locationInvalid = invalidFieldId === 'schedule-location-select';
  const dateInvalid = invalidFieldId === 'schedule-date-input';
  const startInvalid = invalidFieldId === 'schedule-start-time';
  const endInvalid = invalidFieldId === 'schedule-end-time';
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="schedule-location-select" className="text-sm font-medium text-foreground">
          Location <RequiredMark />
        </Label>
        <Select value={form.location_id} onValueChange={(v) => setForm({ ...form, location_id: v })}>
          <SelectTrigger
            id="schedule-location-select"
            data-testid="schedule-location-select"
            className="h-10 bg-muted/50 dark:bg-muted/50"
            aria-required="true"
            aria-describedby={selectedLocation ? 'schedule-location-drive' : undefined}
            aria-invalid={locationInvalid || undefined}
          >
            <SelectValue placeholder="Select a location" />
          </SelectTrigger>
          <SelectContent>
            {(locations || []).map(loc => (
              <SelectItem key={loc.id} value={loc.id}>
                <div className="flex items-center gap-2">
                  <MapPin className="w-3 h-3 text-spoke-strong" aria-hidden="true" />
                  {loc.city_name}
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0 bg-muted text-foreground/80 dark:text-muted-foreground">
                    {loc.drive_time_minutes}m
                  </Badge>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedLocation && (
          <div
            id="schedule-location-drive"
            className="flex items-center gap-2 px-3 py-2 bg-muted/50 dark:bg-muted rounded-lg"
          >
            <Car className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-xs text-foreground/80 dark:text-muted-foreground">
              Estimated drive: <span className="font-semibold text-foreground">{selectedLocation.drive_time_minutes} min</span> each way from Hub
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <Label htmlFor="schedule-date-input" className="text-sm font-medium text-foreground">
            Date <RequiredMark />
          </Label>
          <Input
            id="schedule-date-input"
            type="date"
            data-testid="schedule-date-input"
            value={form.date}
            onChange={(e) => onDateChange(e.target.value)}
            className="h-10 bg-muted/50 dark:bg-muted/50"
            required
            aria-required="true"
            aria-describedby={hasConflicts ? 'schedule-conflicts-region' : undefined}
            aria-invalid={dateInvalid || undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="schedule-start-time" className="text-sm font-medium text-foreground">
            Start Time <RequiredMark />
          </Label>
          <Input
            id="schedule-start-time"
            type="time"
            data-testid="schedule-start-time"
            value={form.start_time}
            onChange={(e) => setForm({ ...form, start_time: e.target.value })}
            className="h-10 bg-muted/50 dark:bg-muted/50"
            required
            aria-required="true"
            aria-describedby={hasConflicts ? 'schedule-conflicts-region' : undefined}
            aria-invalid={startInvalid || undefined}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="schedule-end-time" className="text-sm font-medium text-foreground">
            End Time <RequiredMark />
          </Label>
          <Input
            id="schedule-end-time"
            type="time"
            data-testid="schedule-end-time"
            value={form.end_time}
            onChange={(e) => setForm({ ...form, end_time: e.target.value })}
            className="h-10 bg-muted/50 dark:bg-muted/50"
            required
            aria-required="true"
            aria-describedby={hasConflicts ? 'schedule-conflicts-region' : undefined}
            aria-invalid={endInvalid || undefined}
          />
        </div>
      </div>

      {conflictPreviewError && (
        <div
          role="alert"
          data-testid="conflict-preview-error"
          className="p-3 bg-danger-soft/10 border border-danger-soft dark:border-danger-soft/40 rounded-lg flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4 text-danger-strong shrink-0" aria-hidden="true" />
          <p className="text-xs text-danger-strong flex-1">
            Couldn't check for conflicts. Any hidden overlaps won't be shown until you retry.
          </p>
          {onRetryConflictPreview && (
            <button
              type="button"
              onClick={onRetryConflictPreview}
              className="text-xs font-medium text-danger-strong hover:text-danger-strong dark:hover:text-danger-strong-soft inline-flex items-center gap-1"
              data-testid="conflict-preview-retry"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      )}

      {/* Conflict preview region — announced to screen readers when
          conflicts appear. All three conflict types share one aria region
          so we don't flood with alerts. */}
      {hasConflicts && (
        <div id="schedule-conflicts-region" aria-live="polite" className="space-y-3">
          {/* Outlook calendar conflict preview */}
          {previewConflicts?.outlook_conflicts?.length > 0 && (
            <div className="p-3 bg-info-soft border border-info/30 rounded-lg space-y-2" data-testid="outlook-conflict-banner" role="alert">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-info-strong" aria-hidden="true" />
                <span className="text-xs font-semibold text-info-strong">
                  Outlook Calendar Conflicts
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {previewConflicts.outlook_conflicts.map((c) => (
                  <Badge
                    key={`${c.status}-${c.start}-${c.end}`}
                    variant="secondary"
                    className={`text-[10px] px-2 py-0.5 ${OUTLOOK_STATUS_COLORS[c.status] || 'bg-muted text-foreground'}`}
                  >
                    {OUTLOOK_STATUS_LABELS[c.status] || c.status} {formatOutlookTime(c.start)}–{formatOutlookTime(c.end)}
                  </Badge>
                ))}
              </div>
              <p className="text-[11px] text-info-strong">
                This employee has Outlook calendar conflicts during this time.
              </p>
            </div>
          )}

          {/* Google Calendar conflict preview */}
          {previewConflicts?.google_conflicts?.length > 0 && (
            <div className="p-3 bg-spoke-soft border border-spoke/30 rounded-lg space-y-2" data-testid="google-conflict-banner" role="alert">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-spoke-strong" aria-hidden="true" />
                <span className="text-xs font-semibold text-spoke-strong">
                  Google Calendar Conflicts
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {previewConflicts.google_conflicts.map((c) => (
                  <Badge
                    key={`google-${c.start}-${c.end}`}
                    variant="secondary"
                    className="text-[10px] px-2 py-0.5 bg-danger-soft text-danger-strong"
                  >
                    Busy {formatOutlookTime(c.start)}&ndash;{formatOutlookTime(c.end)}
                  </Badge>
                ))}
              </div>
              <p className="text-[11px] text-spoke-strong">
                This employee has Google Calendar conflicts during this time.
              </p>
            </div>
          )}

          {/* Internal schedule conflict preview */}
          {previewConflicts?.conflicts?.length > 0 && (
            <div className="p-3 bg-warn-soft border border-warn/30 rounded-lg space-y-2" data-testid="internal-conflict-banner" role="alert">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warn-strong" aria-hidden="true" />
                <span className="text-xs font-semibold text-warn-strong">
                  Schedule Conflicts
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {previewConflicts.conflicts.map((c) => (
                  <Badge key={`${c.location}-${c.time}`} variant="secondary" className="text-[10px] px-2 py-0.5 bg-warn-soft text-warn-strong">
                    {c.location} ({c.time})
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Day travel chain preview with inline per-leg overrides */}
      <TravelChainPreview travelChain={travelChain} onOverrideChange={onOverrideChange} />

      <div className="space-y-2">
        <Label htmlFor="schedule-notes-input" className="text-sm font-medium text-foreground">Notes (optional)</Label>
        <Input
          id="schedule-notes-input"
          data-testid="schedule-notes-input"
          placeholder="Additional notes..."
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="h-10 bg-muted/50 dark:bg-muted/50"
        />
      </div>
    </>
  );
}

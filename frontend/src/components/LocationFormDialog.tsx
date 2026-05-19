import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { locationsAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { useLocationDriveTime } from '../features/manager/hooks';
import type { LocationFormState } from '../features/manager/types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import PlacesAutocomplete from './PlacesAutocomplete';

export type EditableLocation = {
  id: string;
  city_name?: string;
  drive_time_minutes?: number;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type PlaceSelection = {
  city_name: string;
  address?: string;
  latitude: number;
  longitude: number;
};

type LocationFormDialogProps = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingLocation?: EditableLocation | null;
  onSaved: () => unknown;
}>;

function getMapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY;
}

function hasUsableMapsKey(key: string | undefined): key is string {
  return !!key && key !== 'YOUR_GOOGLE_MAPS_API_KEY';
}

function emptyLocationForm(): LocationFormState {
  return {
    address: '',
    city_name: '',
    drive_time_minutes: '',
    latitude: '',
    longitude: '',
  };
}

function formFromLocation(location: EditableLocation): LocationFormState {
  return {
    address: location.address || '',
    city_name: location.city_name || '',
    drive_time_minutes: location.drive_time_minutes == null ? '' : String(location.drive_time_minutes),
    latitude: location.latitude == null ? '' : String(location.latitude),
    longitude: location.longitude == null ? '' : String(location.longitude),
  };
}

function nullableString(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number.parseFloat(trimmed) : null;
}

function isPacContainerTarget(target: unknown) {
  return target instanceof Element && !!target.closest('.pac-container');
}

export default function LocationFormDialog({
  open,
  onOpenChange,
  editingLocation,
  onSaved,
}: LocationFormDialogProps) {
  const [form, setForm] = useState<LocationFormState>(emptyLocationForm);
  const [loading, setLoading] = useState(false);
  const [driveTimeTouched, setDriveTimeTouched] = useState(false);
  const [showAdvancedCoordinates, setShowAdvancedCoordinates] = useState(false);
  const {
    calculatingDrive,
    autoFillDriveTime,
    driveTimeError,
    clearDriveTimeError,
  } = useLocationDriveTime(setForm);

  useEffect(() => {
    if (!open) return;
    setForm(editingLocation ? formFromLocation(editingLocation) : emptyLocationForm());
    setDriveTimeTouched(false);
    clearDriveTimeError();
    setShowAdvancedCoordinates(false);
  }, [clearDriveTimeError, editingLocation, open]);

  const handlePlaceSelect = useCallback(async ({ city_name, address, latitude, longitude }: PlaceSelection) => {
    setForm(prev => ({
      ...prev,
      address: address || prev.address,
      city_name,
      latitude: String(latitude),
      longitude: String(longitude),
    }));

    // Preserve an explicit drive-time value if the user already typed one.
    if (driveTimeTouched) {
      toast.info('Kept your manual drive-time value. Clear the field to auto-calculate.');
      return;
    }

    await autoFillDriveTime(latitude, longitude);
  }, [autoFillDriveTime, driveTimeTouched]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.city_name.trim() || !form.drive_time_minutes.trim()) {
      toast.error('Location name and drive time are required');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        city_name: form.city_name.trim(),
        drive_time_minutes: Number.parseInt(form.drive_time_minutes, 10),
        address: nullableString(form.address),
        latitude: nullableNumber(form.latitude),
        longitude: nullableNumber(form.longitude),
      };

      if (editingLocation) {
        await locationsAPI.update(editingLocation.id, payload);
        toast.success('Location updated');
      } else {
        await locationsAPI.create(payload);
        toast.success('Location added');
      }

      await Promise.resolve(onSaved());
      onOpenChange(false);
    } catch (err) {
      toast.error(describeApiError(err, 'Couldn\u2019t save that location \u2014 please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const mapsKey = getMapsKey();
  const mapsEnabled = hasUsableMapsKey(mapsKey);
  const saveLabel = loading
    ? 'Saving...'
    : editingLocation
      ? 'Update Location'
      : 'Add Location';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[440px] bg-white dark:bg-card"
        data-testid="location-form-dialog"
        onPointerDownOutside={(e) => {
          // Radix uses custom events - the real DOM target is in detail.originalEvent.
          const target = e.detail?.originalEvent?.target || e.target;
          if (isPacContainerTarget(target)) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          const target = e.detail?.originalEvent?.target || e.target;
          if (isPacContainerTarget(target)) {
            e.preventDefault();
          }
        }}
        onFocusOutside={(e) => {
          const target = e.detail?.originalEvent?.relatedTarget || e.target;
          if (isPacContainerTarget(target)) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {editingLocation ? 'Edit Location' : 'Add Location'}
          </DialogTitle>
          <DialogDescription>
            {editingLocation
              ? 'Update the location details.'
              : 'Search by address to fill coordinates and drive time, or enter the details manually.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="location-address-input">Location address</Label>
            {mapsEnabled ? (
              <APIProvider apiKey={mapsKey} libraries={['places']}>
                <PlacesAutocomplete
                  id="location-address-input"
                  value={form.address}
                  onChange={(val) => setForm(prev => ({ ...prev, address: val }))}
                  onSelect={handlePlaceSelect}
                  placeholder="Search for an address..."
                  disabled={loading}
                />
              </APIProvider>
            ) : (
              <Input
                id="location-address-input"
                data-testid="location-address-input"
                placeholder="2210 Grand Ave, Des Moines, IA"
                value={form.address}
                onChange={(e) => setForm(prev => ({ ...prev, address: e.target.value }))}
                className="bg-muted/50"
              />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-name-input">Location name</Label>
            <Input
              id="location-name-input"
              data-testid="location-name-input"
              placeholder="e.g. Ames, IA"
              value={form.city_name}
              onChange={(e) => setForm(prev => ({ ...prev, city_name: e.target.value }))}
              required
              className="bg-muted/50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location-drive-time-input">Drive Time from Hub (minutes)</Label>
            <div className="relative">
              <Input
                id="location-drive-time-input"
                type="number"
                data-testid="location-drive-time-input"
                placeholder="e.g. 45"
                value={form.drive_time_minutes}
                onChange={(e) => {
                  setForm(prev => ({ ...prev, drive_time_minutes: e.target.value }));
                  setDriveTimeTouched(e.target.value !== '');
                  clearDriveTimeError();
                }}
                required
                className="bg-muted/50"
              />
              {calculatingDrive && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 animate-spin text-hub" aria-label="Calculating drive time" />
                </div>
              )}
            </div>
            {driveTimeError && (
              <p role="alert" className="text-xs text-danger-strong">
                {driveTimeError}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowAdvancedCoordinates(prev => !prev)}
              className="h-auto w-full justify-between p-0 text-sm font-medium hover:bg-transparent"
              aria-expanded={showAdvancedCoordinates}
            >
              <span>Advanced coordinates</span>
              <span className="text-xs text-muted-foreground">
                {showAdvancedCoordinates ? 'Hide' : 'Show'}
              </span>
            </Button>
            {showAdvancedCoordinates && (
              <div className="grid grid-cols-2 gap-3 pt-3">
                <div className="space-y-2">
                  <Label htmlFor="location-lat-input">Latitude</Label>
                  <Input
                    id="location-lat-input"
                    type="number"
                    step="any"
                    data-testid="location-lat-input"
                    placeholder="41.5868"
                    value={form.latitude}
                    onChange={(e) => setForm(prev => ({ ...prev, latitude: e.target.value }))}
                    className="bg-muted/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location-lng-input">Longitude</Label>
                  <Input
                    id="location-lng-input"
                    type="number"
                    step="any"
                    data-testid="location-lng-input"
                    placeholder="-93.6540"
                    value={form.longitude}
                    onChange={(e) => setForm(prev => ({ ...prev, longitude: e.target.value }))}
                    className="bg-muted/50"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="submit"
              data-testid="location-save-btn"
              disabled={loading || calculatingDrive}
              className="bg-hub hover:bg-hub-strong text-white w-full"
            >
              {calculatingDrive ? 'Calculating drive time...' : saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

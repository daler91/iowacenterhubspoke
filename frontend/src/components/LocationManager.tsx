import { useState, useCallback, memo } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { PageShell } from './ui/page-shell';
import { MapPin, Plus, Pencil, Trash2, Car, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { locationsAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { useAuth } from '../lib/auth';
import { APIProvider } from '@vis.gl/react-google-maps';
import PlacesAutocomplete from './PlacesAutocomplete';

import { useOutletContext } from 'react-router-dom';
import { EntityLink } from './ui/entity-link';
import LocationProfile from './LocationProfile';
import { useLocationDriveTime } from '../features/manager/hooks';

function getMapsKey() {
  return import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY;
}

function hasUsableMapsKey(key: string | undefined): key is string {
  return !!key && key !== 'YOUR_GOOGLE_MAPS_API_KEY';
}

const emptyLocationForm = () => ({
  address: '',
  city_name: '',
  drive_time_minutes: '',
  latitude: '',
  longitude: '',
});

function nullableString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string) {
  const trimmed = value.trim();
  return trimmed ? Number.parseFloat(trimmed) : null;
}

// One location card, memoized so editing or deleting a single location
// doesn't force every sibling card to re-render. The parent stabilises
// the handlers with useCallback so the memo comparison actually skips.
type Location = {
  id: string;
  city_name?: string;
  drive_time_minutes?: number;
  address?: string | null;
  latitude?: number;
  longitude?: number;
};

type ScheduleSummary = {
  location_id?: string;
};

type LocationManagerContext = {
  locations?: Location[];
  schedules?: ScheduleSummary[];
  loadingState?: { locations?: boolean };
  fetchLocations: () => unknown;
  fetchActivities: () => unknown;
};

type PlaceSelection = {
  city_name: string;
  address?: string;
  latitude: number;
  longitude: number;
};

function isPacContainerTarget(target: unknown) {
  return target instanceof Element && !!target.closest('.pac-container');
}

type LocationRowProps = {
  loc: Location;
  isAdmin: boolean;
  onView: (id: string) => void;
  onEdit: (loc: Location) => void;
  onDelete: (loc: Location) => void;
};

const LocationRow = memo(function LocationRow({
  loc, isAdmin, onView, onEdit, onDelete,
}: LocationRowProps) {
  return (
    <div
      data-testid={`location-card-${loc.id}`}
      className="bg-white dark:bg-card rounded-lg border border-border p-4 flex items-center justify-between hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-spoke-soft rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-spoke-strong" />
        </div>
        <div>
          <EntityLink type="location" id={loc.id} className="font-semibold text-foreground">{loc.city_name}</EntityLink>
          <div className="flex flex-col gap-1 mt-1">
            {loc.address && (
              <p className="text-xs text-muted-foreground line-clamp-1">{loc.address}</p>
            )}
            <div className="flex items-center gap-1">
              <Car className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-foreground/80 dark:text-muted-foreground">{loc.drive_time_minutes} min from Hub</span>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          data-testid={`view-location-${loc.id}`}
          onClick={() => onView(loc.id)}
          className="text-muted-foreground hover:text-spoke-strong"
          aria-label={`View ${loc.city_name}`}
        >
          <Eye className="w-4 h-4" aria-hidden="true" />
        </Button>
        {isAdmin && (
          <>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`edit-location-${loc.id}`}
              onClick={() => onEdit(loc)}
              className="text-muted-foreground hover:text-hub"
              aria-label={`Edit ${loc.city_name}`}
            >
              <Pencil className="w-4 h-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid={`delete-location-${loc.id}`}
              onClick={() => onDelete(loc)}
              className="text-muted-foreground hover:text-danger-strong"
              aria-label={`Delete ${loc.city_name}`}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

export default function LocationManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { locations, schedules, loadingState, fetchLocations, fetchActivities } = useOutletContext<LocationManagerContext>();
  const onRefresh = useCallback(() => {
    fetchLocations();
    fetchActivities();
  }, [fetchLocations, fetchActivities]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const onViewProfile = useCallback((id: string) => setSelectedLocationId(id), []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState(emptyLocationForm);
  const [loading, setLoading] = useState(false);
  const {
    calculatingDrive,
    autoFillDriveTime,
    driveTimeError,
    clearDriveTimeError,
  } = useLocationDriveTime(setForm);
  const [driveTimeTouched, setDriveTimeTouched] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const [showAdvancedCoordinates, setShowAdvancedCoordinates] = useState(false);

  const handlePlaceSelect = useCallback(async ({ city_name, address, latitude, longitude }: PlaceSelection) => {
    setForm(prev => ({
      ...prev,
      address: address || prev.address,
      city_name,
      latitude: String(latitude),
      longitude: String(longitude),
    }));

    // If the user has already typed a drive-time value manually, don't
    // clobber it. Users expect their explicit edits to survive when they
    // tweak the address. They can clear the field to re-trigger auto-calc.
    if (driveTimeTouched) {
      toast.info('Kept your manual drive-time value. Clear the field to auto-calculate.');
      return;
    }

    // Auto-calculate drive time from hub when coordinates are available.
    await autoFillDriveTime(latitude, longitude);
  }, [autoFillDriveTime, driveTimeTouched]);

  const openNew = () => {
    setEditing(null);
    setForm(emptyLocationForm());
    setDriveTimeTouched(false);
    clearDriveTimeError();
    setShowAdvancedCoordinates(false);
    setDialogOpen(true);
  };

  // Stable handlers so LocationRow's React.memo can skip re-renders for
  // sibling cards when one card mutates.
  const openEdit = useCallback((loc: Location) => {
    setEditing(loc);
    setForm({
      address: loc.address || '',
      city_name: loc.city_name || '',
      drive_time_minutes: loc.drive_time_minutes == null ? '' : String(loc.drive_time_minutes),
      latitude: loc.latitude ? String(loc.latitude) : '',
      longitude: loc.longitude ? String(loc.longitude) : '',
    });
    // Existing rows start untouched — the stored value is the source of
    // truth until the user either clears the field or edits it.
    setDriveTimeTouched(false);
    clearDriveTimeError();
    setShowAdvancedCoordinates(false);
    setDialogOpen(true);
  }, [clearDriveTimeError]);

  const openDelete = useCallback((loc: Location) => setDeleteTarget(loc), []);

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
      if (editing) {
        await locationsAPI.update(editing.id, payload);
        toast.success('Location updated');
      } else {
        await locationsAPI.create(payload);
        toast.success('Location added');
      }
      onRefresh();
      setDialogOpen(false);
    } catch (err) {
      toast.error(describeApiError(err, 'Couldn\u2019t save that location \u2014 please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id?: string) => {
    if (!id) return;
    try {
      await locationsAPI.delete(id);
      toast.success('Location deleted');
      onRefresh();
    } catch (err) {
      toast.error(describeApiError(err, 'Couldn\u2019t delete that location \u2014 it may still be used by schedules.'));
    } finally {
      setDeleteTarget(null);
    }
  };

  let saveLabel = 'Add Location';
  if (loading) saveLabel = 'Saving...';
  else if (editing) saveLabel = 'Update Location';

  if (selectedLocationId) {
    return <LocationProfile locationId={selectedLocationId} onBack={() => setSelectedLocationId(null)} />;
  }

  const mapsKey = getMapsKey();
  const mapsEnabled = hasUsableMapsKey(mapsKey);

  return (
    <PageShell
      testId="location-manager"
      breadcrumbs={[{ label: 'Manage' }, { label: 'Locations' }]}
      title="Locations"
      subtitle="Manage spoke locations and drive times from Hub"
      status={loadingState?.locations ? { kind: 'loading', variant: 'list' } : { kind: 'ready' }}
      actions={
        isAdmin ? (
          <Button
            data-testid="add-location-btn"
            onClick={openNew}
            disabled={!!loadingState?.locations}
            className="bg-hub hover:bg-hub-strong text-white rounded-lg shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
            Add Location
          </Button>
        ) : undefined
      }
    >
      {/* Hub Info */}
      <div className="bg-hub-soft border border-hub/20 rounded-lg p-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-hub rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-hub-strong text-sm">Hub Location</p>
          <p className="text-xs text-hub">2210 Grand Ave, Des Moines, IA 50312</p>
        </div>
      </div>

      {/* Location list */}
      <div className="grid gap-3">
        {(locations || []).map(loc => (
          <LocationRow
            key={loc.id}
            loc={loc}
            isAdmin={isAdmin}
            onView={onViewProfile}
            onEdit={openEdit}
            onDelete={openDelete}
          />
        ))}

        {(!locations || locations.length === 0) && (
          <div className="text-center py-12 text-muted-foreground">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No locations yet</p>
            <p className="text-sm">Add your first spoke location</p>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="sm:max-w-[440px] bg-white dark:bg-card"
          data-testid="location-form-dialog"
          onPointerDownOutside={(e) => {
            // Radix uses custom events - the real DOM target is in detail.originalEvent
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
            // Prevent focus trap from fighting with Places dropdown
            const target = e.detail?.originalEvent?.relatedTarget || e.target;
            if (isPacContainerTarget(target)) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {editing ? 'Edit Location' : 'Add Location'}
            </DialogTitle>
            <DialogDescription>
              {editing
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
                    onChange={(val) => setForm({ ...form, address: val })}
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
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
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
                onChange={(e) => setForm({ ...form, city_name: e.target.value })}
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
                    setForm({ ...form, drive_time_minutes: e.target.value });
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
                Advanced coordinates
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
                      onChange={(e) => setForm({ ...form, latitude: e.target.value })}
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
                      onChange={(e) => setForm({ ...form, longitude: e.target.value })}
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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.city_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const count = (schedules || []).filter(s => s.location_id === deleteTarget?.id).length;
                if (count === 0) {
                  return 'This location has no schedules. Deleting it cannot be undone.';
                }
                return `${deleteTarget?.city_name} is used by ${count} schedule${count === 1 ? '' : 's'}. Deleting it may fail on the backend. This action cannot be undone.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-danger hover:bg-danger" onClick={(e: MouseEvent<HTMLButtonElement>) => { e.preventDefault(); handleDelete(deleteTarget?.id); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

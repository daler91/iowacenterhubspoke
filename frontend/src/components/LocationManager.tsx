import { memo, useCallback, useState } from 'react';
import type { MouseEvent } from 'react';
import { Car, Eye, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOutletContext } from 'react-router-dom';
import { locationsAPI } from '../lib/api';
import { describeApiError } from '../lib/error-messages';
import { useAuth } from '../lib/auth';
import { Button } from './ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { EntityLink } from './ui/entity-link';
import { PageShell } from './ui/page-shell';
import LocationFormDialog from './LocationFormDialog';
import type { EditableLocation } from './LocationFormDialog';
import LocationProfile from './LocationProfile';

type Location = EditableLocation;

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
  }, [fetchActivities, fetchLocations]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const onViewProfile = useCallback((id: string) => setSelectedLocationId(id), []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

  const openNew = useCallback(() => {
    setEditing(null);
    setDialogOpen(true);
  }, []);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setEditing(null);
    }
  }, []);

  const openEdit = useCallback((loc: Location) => {
    setEditing(loc);
    setDialogOpen(true);
  }, []);

  const openDelete = useCallback((loc: Location) => setDeleteTarget(loc), []);

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

  if (selectedLocationId) {
    return <LocationProfile locationId={selectedLocationId} onBack={() => setSelectedLocationId(null)} />;
  }

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
      <div className="bg-hub-soft border border-hub/20 rounded-lg p-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-hub rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-hub-strong text-sm">Hub Location</p>
          <p className="text-xs text-hub">2210 Grand Ave, Des Moines, IA 50312</p>
        </div>
      </div>

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

      <LocationFormDialog
        open={dialogOpen}
        onOpenChange={handleDialogOpenChange}
        editingLocation={editing}
        onSaved={onRefresh}
      />

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

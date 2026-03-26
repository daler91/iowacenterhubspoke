import { useState, useCallback } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { MapPin, Plus, Pencil, Trash2, Car, Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { locationsAPI } from '../lib/api';
import { useAuth } from '../lib/auth';
import { APIProvider } from '@vis.gl/react-google-maps';
import PlacesAutocomplete from './PlacesAutocomplete';

import { useOutletContext } from 'react-router-dom';
import LocationProfile from './LocationProfile';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY;

export default function LocationManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { locations, fetchLocations, fetchActivities } = useOutletContext();
  const onRefresh = () => {
    fetchLocations();
    fetchActivities();
  };
  const [selectedLocationId, setSelectedLocationId] = useState(null);
  const onViewProfile = (id) => setSelectedLocationId(id);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ city_name: '', drive_time_minutes: '', latitude: '', longitude: '' });
  const [loading, setLoading] = useState(false);
  const [calculatingDrive, setCalculatingDrive] = useState(false);

  const handlePlaceSelect = useCallback(async ({ city_name, latitude, longitude }) => {
    setForm(prev => ({
      ...prev,
      city_name,
      latitude: String(latitude),
      longitude: String(longitude),
    }));

    // Auto-calculate drive time from hub
    setCalculatingDrive(true);
    try {
      const res = await locationsAPI.getDriveTimeFromHub(latitude, longitude);
      setForm(prev => ({ ...prev, drive_time_minutes: String(res.data.drive_time_minutes) }));
    } catch {
      // Keep manual entry if calculation fails
    } finally {
      setCalculatingDrive(false);
    }
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ city_name: '', drive_time_minutes: '', latitude: '', longitude: '' });
    setDialogOpen(true);
  };

  const openEdit = (loc) => {
    setEditing(loc);
    setForm({
      city_name: loc.city_name,
      drive_time_minutes: String(loc.drive_time_minutes),
      latitude: loc.latitude ? String(loc.latitude) : '',
      longitude: loc.longitude ? String(loc.longitude) : '',
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.city_name || !form.drive_time_minutes) {
      toast.error('City name and drive time are required');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        city_name: form.city_name,
        drive_time_minutes: Number.parseInt(form.drive_time_minutes, 10),
        latitude: form.latitude ? Number.parseFloat(form.latitude) : null,
        longitude: form.longitude ? Number.parseFloat(form.longitude) : null,
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
      toast.error(err.response?.data?.detail || 'Failed to save location');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await locationsAPI.delete(id);
      toast.success('Location deleted');
      onRefresh();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete location');
    }
  };

  let saveLabel = 'Add Location';
  if (loading) saveLabel = 'Saving...';
  else if (editing) saveLabel = 'Update Location';

  if (selectedLocationId) {
    return <LocationProfile locationId={selectedLocationId} onBack={() => setSelectedLocationId(null)} />;
  }

  return (
    <div className="space-y-6 animate-slide-in" data-testid="location-manager">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Locations</h2>
          <p className="text-sm text-slate-500 mt-1">Manage spoke locations and drive times from Hub</p>
        </div>
        {isAdmin && (
          <Button
            data-testid="add-location-btn"
            onClick={openNew}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Location
          </Button>
        )}
      </div>

      {/* Hub Info */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-semibold text-indigo-900 text-sm">Hub Location</p>
          <p className="text-xs text-indigo-600">2210 Grand Ave, Des Moines, IA 50312</p>
        </div>
      </div>

      {/* Location list */}
      <div className="grid gap-3">
        {(locations || []).map(loc => (
          <div
            key={loc.id}
            data-testid={`location-card-${loc.id}`}
            className="bg-white rounded-xl border border-gray-100 p-4 flex items-center justify-between hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center">
                <MapPin className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="font-semibold text-slate-800">{loc.city_name}</p>
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1">
                    <Car className="w-3 h-3 text-slate-400" />
                    <span className="text-xs text-slate-500">{loc.drive_time_minutes} min from Hub</span>
                  </div>
                  {loc.latitude && (
                    <span className="text-xs text-slate-400">
                      {loc.latitude.toFixed(2)}, {loc.longitude?.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                data-testid={`view-location-${loc.id}`}
                onClick={() => onViewProfile(loc.id)}
                className="text-slate-400 hover:text-teal-600"
              >
                <Eye className="w-4 h-4" />
              </Button>
              {isAdmin && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`edit-location-${loc.id}`}
                    onClick={() => openEdit(loc)}
                    className="text-slate-400 hover:text-indigo-600"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`delete-location-${loc.id}`}
                    onClick={() => handleDelete(loc.id)}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}

        {(!locations || locations.length === 0) && (
          <div className="text-center py-12 text-slate-400">
            <MapPin className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No locations yet</p>
            <p className="text-sm">Add your first spoke location</p>
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[440px] bg-white" data-testid="location-form-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'Manrope, sans-serif' }}>
              {editing ? 'Edit Location' : 'Add Location'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the location details.'
                : 'Search for a city to auto-fill coordinates and drive time, or enter manually.'}
            </DialogDescription>
          </DialogHeader>
          {MAPS_KEY && MAPS_KEY !== 'YOUR_GOOGLE_MAPS_API_KEY' ? (
            <APIProvider apiKey={MAPS_KEY} libraries={['places']}>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>City Name</Label>
                  <PlacesAutocomplete
                    value={form.city_name}
                    onChange={(val) => setForm({ ...form, city_name: val })}
                    onSelect={handlePlaceSelect}
                    placeholder="Search for a city..."
                    disabled={loading}
                  />
                  <p className="text-[11px] text-slate-400">
                    Select from suggestions to auto-fill coordinates and drive time
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Drive Time from Hub (minutes)</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      data-testid="location-drive-time-input"
                      placeholder="e.g. 45"
                      value={form.drive_time_minutes}
                      onChange={(e) => setForm({ ...form, drive_time_minutes: e.target.value })}
                      required
                      className="bg-gray-50/50"
                    />
                    {calculatingDrive && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Latitude</Label>
                    <Input
                      type="number"
                      step="any"
                      data-testid="location-lat-input"
                      placeholder="41.5868"
                      value={form.latitude}
                      onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                      className="bg-gray-50/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Longitude</Label>
                    <Input
                      type="number"
                      step="any"
                      data-testid="location-lng-input"
                      placeholder="-93.6540"
                      value={form.longitude}
                      onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                      className="bg-gray-50/50"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="submit"
                    data-testid="location-save-btn"
                    disabled={loading || calculatingDrive}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white w-full"
                  >
                    {calculatingDrive ? 'Calculating drive time...' : saveLabel}
                  </Button>
                </DialogFooter>
              </form>
            </APIProvider>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>City Name</Label>
                <Input
                  data-testid="location-city-input"
                  placeholder="e.g. Ames"
                  value={form.city_name}
                  onChange={(e) => setForm({ ...form, city_name: e.target.value })}
                  required
                  className="bg-gray-50/50"
                />
              </div>
              <div className="space-y-2">
                <Label>Drive Time from Hub (minutes)</Label>
                <Input
                  type="number"
                  data-testid="location-drive-time-input"
                  placeholder="e.g. 45"
                  value={form.drive_time_minutes}
                  onChange={(e) => setForm({ ...form, drive_time_minutes: e.target.value })}
                  required
                  className="bg-gray-50/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Latitude (optional)</Label>
                  <Input
                    type="number"
                    step="any"
                    data-testid="location-lat-input"
                    placeholder="41.5868"
                    value={form.latitude}
                    onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                    className="bg-gray-50/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Longitude (optional)</Label>
                  <Input
                    type="number"
                    step="any"
                    data-testid="location-lng-input"
                    placeholder="-93.6540"
                    value={form.longitude}
                    onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                    className="bg-gray-50/50"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="submit"
                  data-testid="location-save-btn"
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white w-full"
                >
                  {saveLabel}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}


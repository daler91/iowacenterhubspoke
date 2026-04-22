import { memo, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { MapPin, Car, Navigation } from 'lucide-react';
import { Badge } from './ui/badge';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const HUB = { lat: 41.5868, lng: -93.654 };
// Stable empty-array reference so `SpokeMarker`'s memo doesn't invalidate when
// a location has no schedules (a fresh `[]` would be a new ref each render).
const EMPTY_LIST: never[] = [];

import { useOutletContext, useNavigate } from 'react-router-dom';

// Memoised so adding/updating a single schedule doesn't re-render every marker
// on the map — only the one(s) whose `locSchedules` array reference changed.
// `navigate` is a stable ref from react-router, so building the click handler
// inline here is memo-safe (unlike passing `() => navigate(...)` from the
// parent map, which would create a fresh function per render per marker).
const SpokeMarker = memo(function SpokeMarker({ loc, locSchedules, navigate }) {
  const classCountLabel = locSchedules.length === 1 ? '1 class today' : `${locSchedules.length} classes today`;
  return (
    <AdvancedMarker position={{ lat: loc.latitude, lng: loc.longitude }}>
      <button
        type="button"
        onClick={() => navigate(`/locations/${loc.id}`)}
        aria-label={`${loc.city_name}, ${loc.drive_time_minutes} minutes from hub, ${classCountLabel}. Open location details.`}
        data-testid={`spoke-marker-${loc.id}`}
        className="relative group cursor-pointer bg-transparent border-0 p-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-600"
      >
        <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
          <Navigation className="w-5 h-5 text-white" aria-hidden="true" />
        </div>
        {locSchedules.length > 0 && (
          <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm" aria-hidden="true">
            {locSchedules.length}
          </div>
        )}
        <div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50 pointer-events-none"
          aria-hidden="true"
        >
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-3 min-w-[220px] text-left">
            <p className="font-bold text-sm text-teal-700 dark:text-teal-400">{loc.city_name}</p>
            <div className="flex items-center gap-2 mt-1">
              <Car className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
              <span className="text-xs text-slate-500 dark:text-gray-400">{loc.drive_time_minutes} min from Hub</span>
            </div>
            {locSchedules.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Today's Classes</p>
                {locSchedules.map(s => (
                  <div key={s.id} className="flex items-center gap-2 mt-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.employees?.[0]?.color }} aria-hidden="true" />
                    <span className="text-xs text-slate-600 dark:text-gray-300">{s.employees?.map(e => e.name).join(', ') || 'Unassigned'} ({s.start_time}-{s.end_time})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
    </AdvancedMarker>
  );
});

export default function MapView() {
  const { locations, schedules } = useOutletContext();
  const navigate = useNavigate();
  const validLocations = useMemo(() =>
    (locations || []).filter(l => l.latitude && l.longitude),
    [locations]
  );

  // Recompute on every render so a tab left open past midnight rolls over to
  // the new day. `todayStr` is a string primitive, so useMemo below compares
  // it by value — same-day renders hit the cache, next-day renders invalidate.
  const todayStr = new Date().toISOString().split('T')[0];
  const todayByLoc = useMemo(() => {
    const map: Record<string, typeof schedules> = {};
    (schedules || []).forEach(s => {
      if (s.date !== todayStr) return;
      // Split the lazy-init out of the `.push(...)` call so there's no
      // assignment inside a sub-expression (Sonar typescript:S6660).
      let bucket = map[s.location_id];
      if (!bucket) {
        bucket = [];
        map[s.location_id] = bucket;
      }
      bucket.push(s);
    });
    return map;
  }, [schedules, todayStr]);

  if (!MAPS_KEY || MAPS_KEY === 'YOUR_GOOGLE_MAPS_API_KEY') {
    return (
      <div className="space-y-6 animate-slide-in" data-testid="map-view-fallback">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-gray-100">Map View</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Google Maps API key not configured</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <MapPin className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-slate-500 dark:text-gray-400">Add a Google Maps API key to enable the map view</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in" data-testid="map-view">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-gray-100">Map View</h2>
        <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">Hub and Spoke locations across Iowa</p>
      </div>

      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm" style={{ height: '500px' }}>
        <APIProvider apiKey={MAPS_KEY}>
          <Map
            style={{ width: '100%', height: '100%' }}
            defaultCenter={HUB}
            defaultZoom={7.5}
            mapId="hubspoke-map"
            gestureHandling="greedy"
            disableDefaultUI={false}
            zoomControl={true}
            mapTypeControl={false}
            streetViewControl={false}
          >
            {/* Hub marker */}
            <AdvancedMarker position={HUB}>
              <button
                type="button"
                data-testid="hub-marker"
                aria-label="Central hub: Des Moines, 2210 Grand Ave"
                className="relative group cursor-pointer bg-transparent border-0 p-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-600"
              >
                <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg border-3 border-white">
                  <MapPin className="w-6 h-6 text-white" aria-hidden="true" />
                </div>
                <div
                  className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity z-50 pointer-events-none"
                  aria-hidden="true"
                >
                  <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-3 min-w-[200px] text-left">
                    <p className="font-bold text-sm text-indigo-700 dark:text-indigo-400">Hub - Des Moines</p>
                    <p className="text-xs text-slate-500 dark:text-gray-400 mt-1">2210 Grand Ave, Des Moines, IA 50312</p>
                    <Badge className="mt-2 bg-indigo-100 text-indigo-700 border-0 text-[10px]">Central Hub</Badge>
                  </div>
                </div>
              </button>
            </AdvancedMarker>

            {/* Spoke markers */}
            {validLocations.map(loc => (
              <SpokeMarker
                key={loc.id}
                loc={loc}
                locSchedules={todayByLoc[loc.id] || EMPTY_LIST}
                navigate={navigate}
              />
            ))}
          </Map>
        </APIProvider>
      </div>

      {/* Location legend */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800 dark:text-gray-100">Hub</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">Des Moines</p>
          </div>
        </div>
        {validLocations.map(loc => (
          <button
            key={loc.id}
            type="button"
            className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 p-4 flex items-center gap-3 cursor-pointer hover:shadow-md transition-shadow text-left"
            onClick={() => navigate(`/locations/${loc.id}`)}
          >
            <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
              <Navigation className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 dark:text-gray-100 hover:text-indigo-600 transition-colors">{loc.city_name}</p>
              <p className="text-xs text-slate-500 dark:text-gray-400">{loc.drive_time_minutes}m drive</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}


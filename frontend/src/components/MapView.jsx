import { useMemo } from 'react';
import PropTypes from 'prop-types';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { MapPin, Car, Navigation } from 'lucide-react';
import { Badge } from './ui/badge';

const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || import.meta.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const HUB = { lat: 41.5868, lng: -93.654 };

export default function MapView({ locations, schedules }) {
  const validLocations = useMemo(() =>
    (locations || []).filter(l => l.latitude && l.longitude),
    [locations]
  );

  // Count today's schedules per location
  const todayStr = new Date().toISOString().split('T')[0];
  const todayByLoc = useMemo(() => {
    const map = {};
    (schedules || []).forEach(s => {
      if (s.date === todayStr) {
        if (!map[s.location_id]) map[s.location_id] = [];
        map[s.location_id].push(s);
      }
    });
    return map;
  }, [schedules, todayStr]);

  if (!MAPS_KEY || MAPS_KEY === 'YOUR_GOOGLE_MAPS_API_KEY') {
    return (
      <div className="space-y-6 animate-slide-in" data-testid="map-view-fallback">
        <div>
          <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Map View</h2>
          <p className="text-sm text-slate-500 mt-1">Google Maps API key not configured</p>
        </div>
        <div className="bg-gray-50 rounded-xl border border-gray-200 p-12 text-center">
          <MapPin className="w-16 h-16 mx-auto text-gray-300 mb-4" />
          <p className="text-slate-500">Add a Google Maps API key to enable the map view</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-in" data-testid="map-view">
      <div>
        <h2 className="text-2xl font-bold text-slate-800" style={{ fontFamily: 'Manrope, sans-serif' }}>Map View</h2>
        <p className="text-sm text-slate-500 mt-1">Hub and Spoke locations across Iowa</p>
      </div>

      <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm" style={{ height: '500px' }}>
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
              <div className="relative group cursor-pointer" data-testid="hub-marker">
                <div className="w-12 h-12 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg border-3 border-white">
                  <MapPin className="w-6 h-6 text-white" />
                </div>
                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                  <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-3 min-w-[200px]">
                    <p className="font-bold text-sm text-indigo-700">Hub - Des Moines</p>
                    <p className="text-xs text-slate-500 mt-1">2210 Grand Ave, Des Moines, IA 50312</p>
                    <Badge className="mt-2 bg-indigo-100 text-indigo-700 border-0 text-[10px]">Central Hub</Badge>
                  </div>
                </div>
              </div>
            </AdvancedMarker>

            {/* Spoke markers */}
            {validLocations.map(loc => {
              const locSchedules = todayByLoc[loc.id] || [];
              return (
                <AdvancedMarker key={loc.id} position={{ lat: loc.latitude, lng: loc.longitude }}>
                  <div className="relative group cursor-pointer" data-testid={`spoke-marker-${loc.id}`}>
                    <div className="w-10 h-10 bg-teal-600 rounded-full flex items-center justify-center shadow-lg border-2 border-white">
                      <Navigation className="w-5 h-5 text-white" />
                    </div>
                    {locSchedules.length > 0 && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-sm">
                        {locSchedules.length}
                      </div>
                    )}
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                      <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-3 min-w-[220px]">
                        <p className="font-bold text-sm text-teal-700">{loc.city_name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Car className="w-3 h-3 text-slate-400" />
                          <span className="text-xs text-slate-500">{loc.drive_time_minutes} min from Hub</span>
                        </div>
                        {locSchedules.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Today's Classes</p>
                            {locSchedules.map(s => (
                              <div key={s.id} className="flex items-center gap-2 mt-1">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.employee_color }} />
                                <span className="text-xs text-slate-600">{s.employee_name} ({s.start_time}-{s.end_time})</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </AdvancedMarker>
              );
            })}
          </Map>
        </APIProvider>
      </div>

      {/* Location legend */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">Hub</p>
            <p className="text-xs text-slate-500">Des Moines</p>
          </div>
        </div>
        {validLocations.map(loc => (
          <div key={loc.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3">
            <div className="w-8 h-8 bg-teal-600 rounded-full flex items-center justify-center">
              <Navigation className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{loc.city_name}</p>
              <p className="text-xs text-slate-500">{loc.drive_time_minutes}m drive</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

MapView.propTypes = {
  locations: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      city_name: PropTypes.string,
      latitude: PropTypes.number,
      longitude: PropTypes.number,
      drive_time_minutes: PropTypes.number,
    })
  ),
  schedules: PropTypes.array,
};

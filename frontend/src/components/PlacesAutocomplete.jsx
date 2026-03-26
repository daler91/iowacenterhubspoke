import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Input } from './ui/input';
import { Loader2 } from 'lucide-react';
import PropTypes from 'prop-types';

export default function PlacesAutocomplete({ value, onChange, onSelect, placeholder, disabled }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const places = useMapsLibrary('places');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!places || !inputRef.current) return;

    const autocomplete = new places.Autocomplete(inputRef.current, {
      types: ['(cities)'],
      componentRestrictions: { country: 'us' },
      fields: ['name', 'geometry', 'address_components'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry) return;

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      // Extract state abbreviation from address components
      let cityName = place.name;
      const stateComponent = (place.address_components || []).find(c =>
        c.types.includes('administrative_area_level_1')
      );
      if (stateComponent) {
        cityName = `${place.name}, ${stateComponent.short_name}`;
      }

      onSelect?.({
        city_name: cityName,
        latitude: lat,
        longitude: lng,
      });
    });

    autocompleteRef.current = autocomplete;
    setReady(true);

    return () => {
      if (autocompleteRef.current) {
        window.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [places, onSelect]);

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        data-testid="location-city-input"
        placeholder={placeholder || 'Search for a city...'}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="bg-gray-50/50"
        autoComplete="off"
      />
      {!ready && places === undefined && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
        </div>
      )}
    </div>
  );
}

PlacesAutocomplete.propTypes = {
  value: PropTypes.string,
  onChange: PropTypes.func,
  onSelect: PropTypes.func,
  placeholder: PropTypes.string,
  disabled: PropTypes.bool,
};

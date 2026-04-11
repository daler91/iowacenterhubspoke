import { useEffect, useRef, useCallback } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

export default function PlacesAutocomplete({ id, value, onChange, onSelect, placeholder, disabled }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const places = useMapsLibrary('places');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Sync the input DOM value when parent state changes (e.g. form reset)
  useEffect(() => {
    if (inputRef.current && value !== undefined && document.activeElement !== inputRef.current) {
      inputRef.current.value = value;
    }
  }, [value]);

  const handleInput = useCallback((e) => {
    onChange?.(e.target.value);
  }, [onChange]);

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

      let cityName = place.name;
      const stateComponent = (place.address_components || []).find(c =>
        c.types.includes('administrative_area_level_1')
      );
      if (stateComponent) {
        cityName = `${place.name}, ${stateComponent.short_name}`;
      }

      // Update the input to show our formatted name (not Google's full format)
      if (inputRef.current) {
        inputRef.current.value = cityName;
      }

      onSelectRef.current?.({
        city_name: cityName,
        latitude: lat,
        longitude: lng,
      });
    });

    autocompleteRef.current = autocomplete;

    return () => {
      if (autocompleteRef.current) {
        globalThis.google?.maps?.event?.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [places]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        data-testid="location-city-input"
        placeholder={placeholder || 'Search for a city...'}
        defaultValue={value}
        onInput={handleInput}
        disabled={disabled}
        autoComplete="off"
        className="flex h-10 w-full rounded-lg border border-input bg-gray-50/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {!places && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}


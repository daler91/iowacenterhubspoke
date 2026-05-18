import { useEffect, useRef, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Loader2 } from 'lucide-react';

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types: string[];
};

type SelectedPlace = {
  address_components?: AddressComponent[];
  formatted_address?: string;
  geometry?: {
    location?: {
      lat: () => number;
      lng: () => number;
    };
  };
  name?: string;
};

type PlacesAutocompleteProps = {
  id: string;
  value?: string;
  onChange?: (value: string) => void;
  onSelect?: (place: {
    city_name: string;
    address: string;
    latitude: number;
    longitude: number;
  }) => void;
  placeholder?: string;
  disabled?: boolean;
};

function getAddressComponent(place: SelectedPlace, type: string) {
  return (place.address_components || []).find(c => c.types.includes(type));
}

function buildLocationLabel(place: SelectedPlace, formattedAddress: string) {
  const city = getAddressComponent(place, 'locality')
    || getAddressComponent(place, 'postal_town')
    || getAddressComponent(place, 'sublocality')
    || getAddressComponent(place, 'administrative_area_level_2');
  const state = getAddressComponent(place, 'administrative_area_level_1');

  if (city?.long_name && state?.short_name) {
    return `${city.long_name}, ${state.short_name}`;
  }
  if (place.name) return place.name;
  return formattedAddress;
}

function clearGoogleListeners(instance: object) {
  const googleGlobal = globalThis as typeof globalThis & {
    google?: { maps?: { event?: { clearInstanceListeners: (target: object) => void } } };
  };
  googleGlobal.google?.maps?.event?.clearInstanceListeners(instance);
}

export default function PlacesAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  placeholder,
  disabled,
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<object | null>(null);
  const places = useMapsLibrary('places');
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Sync the input DOM value when parent state changes (e.g. form reset)
  useEffect(() => {
    if (inputRef.current && value !== undefined && document.activeElement !== inputRef.current) {
      inputRef.current.value = value;
    }
  }, [value]);

  const handleInput = useCallback((e: FormEvent<HTMLInputElement>) => {
    onChange?.(e.currentTarget.value);
  }, [onChange]);

  useEffect(() => {
    if (!places || !inputRef.current) return;

    const autocomplete = new places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'us' },
      fields: ['name', 'formatted_address', 'geometry', 'address_components'],
    });

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace() as SelectedPlace;
      const location = place.geometry?.location;
      if (!location) return;

      const lat = location.lat();
      const lng = location.lng();
      const formattedAddress = place.formatted_address || inputRef.current?.value || place.name || '';
      const cityName = buildLocationLabel(place, formattedAddress);

      // Update the input to show the full selected address.
      if (inputRef.current) {
        inputRef.current.value = formattedAddress;
      }

      onSelectRef.current?.({
        city_name: cityName,
        address: formattedAddress,
        latitude: lat,
        longitude: lng,
      });
    });

    autocompleteRef.current = autocomplete;

    return () => {
      if (autocompleteRef.current) {
        clearGoogleListeners(autocompleteRef.current);
      }
    };
  }, [places]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        data-testid="location-address-input"
        placeholder={placeholder || 'Search for an address...'}
        defaultValue={value}
        onInput={handleInput}
        disabled={disabled}
        autoComplete="off"
        className="flex h-10 w-full rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      />
      {!places && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}


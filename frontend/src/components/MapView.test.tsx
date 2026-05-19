import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { managerFeatureApi } from '../features/manager/api';
import { locationsAPI } from '../lib/api';
import MapView from './MapView';

const mockUseOutletContext = jest.fn();
const mockNavigate = jest.fn();
let mockRole = 'admin';

jest.mock('react-router-dom', () => {
  const { TextDecoder, TextEncoder } = require('node:util');
  globalThis.TextEncoder = globalThis.TextEncoder || TextEncoder;
  globalThis.TextDecoder = globalThis.TextDecoder || TextDecoder;
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => mockUseOutletContext(),
    useNavigate: () => mockNavigate,
  };
});

jest.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: mockRole } }),
}));

jest.mock('../lib/api', () => ({
  locationsAPI: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../features/manager/api', () => ({
  managerFeatureApi: {
    locations: { getDriveTimeFromHub: jest.fn() },
  },
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ children }: { children: React.ReactNode }) => <div data-testid="advanced-marker">{children}</div>,
  useMapsLibrary: jest.fn(),
}));

jest.mock('./PlacesAutocomplete', () => ({
  __esModule: true,
  default: ({ id, value, onChange, disabled }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <input
      id={id}
      data-testid="location-address-input"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const mockedLocationsAPI = locationsAPI as jest.Mocked<typeof locationsAPI>;
const mockedManagerApi = managerFeatureApi as jest.Mocked<typeof managerFeatureApi>;

function renderMap({
  role = 'admin',
  mapsKey = '',
}: {
  role?: string;
  mapsKey?: string;
} = {}) {
  const fetchLocations = jest.fn();
  const fetchActivities = jest.fn();
  mockRole = role;
  process.env.VITE_GOOGLE_MAPS_API_KEY = mapsKey;
  process.env.REACT_APP_GOOGLE_MAPS_API_KEY = '';
  mockUseOutletContext.mockReturnValue({
    locations: [],
    schedules: [],
    loadingState: {},
    fetchLocations,
    fetchActivities,
  });

  const view = render(
    <MemoryRouter>
      <MapView />
    </MemoryRouter>,
  );

  return { ...view, fetchActivities, fetchLocations };
}

describe('MapView add location action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'admin';
    process.env.VITE_GOOGLE_MAPS_API_KEY = '';
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY = '';
    mockedLocationsAPI.create.mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof locationsAPI.create>>);
    (mockedManagerApi.locations.getDriveTimeFromHub as jest.Mock).mockResolvedValue({
      data: { drive_time_minutes: 42 },
    });
  });

  it('opens the add location dialog from the normal map page for admins', () => {
    renderMap({ mapsKey: 'test-maps-key' });

    expect(screen.getByTestId('map-view')).toBeInTheDocument();
    expect(screen.getByTestId('google-map')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('map-add-location-btn'));

    expect(screen.getByTestId('location-form-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('map-view')).toBeInTheDocument();
  });

  it('creates a location from the map fallback and refreshes map data', async () => {
    const { fetchActivities, fetchLocations } = renderMap();

    expect(screen.getByTestId('map-view-fallback')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('map-add-location-btn'));
    fireEvent.change(screen.getByTestId('location-address-input'), {
      target: { value: '500 Main St, Ames, IA' },
    });
    fireEvent.change(screen.getByTestId('location-name-input'), {
      target: { value: 'Ames, IA' },
    });
    fireEvent.change(screen.getByTestId('location-drive-time-input'), {
      target: { value: '35' },
    });
    fireEvent.click(screen.getByTestId('location-save-btn'));

    await waitFor(() => {
      expect(mockedLocationsAPI.create).toHaveBeenCalledWith({
        city_name: 'Ames, IA',
        drive_time_minutes: 35,
        address: '500 Main St, Ames, IA',
        latitude: null,
        longitude: null,
      });
    });
    expect(fetchLocations).toHaveBeenCalled();
    expect(fetchActivities).toHaveBeenCalled();
    expect(screen.getByTestId('map-view-fallback')).toBeInTheDocument();
  });

  it('hides the map add location button for non-admin users', () => {
    renderMap({ role: 'scheduler', mapsKey: 'test-maps-key' });

    expect(screen.queryByTestId('map-add-location-btn')).not.toBeInTheDocument();
  });
});

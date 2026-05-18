import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { managerFeatureApi } from '../features/manager/api';
import { locationsAPI } from '../lib/api';
import LocationManager from './LocationManager';

const mockUseOutletContext = jest.fn();

jest.mock('react-router-dom', () => {
  const { TextDecoder, TextEncoder } = require('util');
  global.TextEncoder = global.TextEncoder || TextEncoder;
  global.TextDecoder = global.TextDecoder || TextDecoder;
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useOutletContext: () => mockUseOutletContext(),
  };
});

jest.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
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
  APIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useMapsLibrary: jest.fn(),
}));

jest.mock('./PlacesAutocomplete', () => ({
  __esModule: true,
  default: ({ id, value, onChange, onSelect, disabled }: {
    id: string;
    value: string;
    onChange: (value: string) => void;
    onSelect: (place: {
      city_name: string;
      address: string;
      latitude: number;
      longitude: number;
    }) => void;
    disabled?: boolean;
  }) => (
    <div>
      <input
        id={id}
        data-testid="location-address-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() => onSelect({
          city_name: 'Des Moines, IA',
          address: '2210 Grand Ave, Des Moines, IA 50312, USA',
          latitude: 41.5868,
          longitude: -93.654,
        })}
      >
        Use mocked address
      </button>
    </div>
  ),
}));

const mockedLocationsAPI = locationsAPI as jest.Mocked<typeof locationsAPI>;
const mockedManagerApi = managerFeatureApi as jest.Mocked<typeof managerFeatureApi>;

function renderManager() {
  mockUseOutletContext.mockReturnValue({
    locations: [],
    schedules: [],
    loadingState: {},
    fetchLocations: jest.fn(),
    fetchActivities: jest.fn(),
  });

  return render(
    <MemoryRouter>
      <LocationManager />
    </MemoryRouter>,
  );
}

describe('LocationManager location entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLocationsAPI.create.mockResolvedValue({ data: {} } as Awaited<ReturnType<typeof locationsAPI.create>>);
    (mockedManagerApi.locations.getDriveTimeFromHub as jest.Mock).mockResolvedValue({
      data: { drive_time_minutes: 42 },
    });
    process.env.REACT_APP_GOOGLE_MAPS_API_KEY = '';
  });

  it('creates a location from an address selection without showing coordinates by default', async () => {
    process.env.VITE_GOOGLE_MAPS_API_KEY = 'test-maps-key';

    renderManager();
    fireEvent.click(screen.getByTestId('add-location-btn'));

    expect(screen.queryByTestId('location-lat-input')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use mocked address' }));

    await waitFor(() => {
      expect(mockedManagerApi.locations.getDriveTimeFromHub).toHaveBeenCalledWith(41.5868, -93.654);
    });
    await waitFor(() => {
      expect(screen.getByTestId('location-drive-time-input')).toHaveValue(42);
    });

    expect(screen.getByTestId('location-address-input')).toHaveValue('2210 Grand Ave, Des Moines, IA 50312, USA');
    expect(screen.getByTestId('location-name-input')).toHaveValue('Des Moines, IA');
    expect(screen.queryByTestId('location-lat-input')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Advanced coordinates/i }));
    expect(screen.getByTestId('location-lat-input')).toHaveValue(41.5868);
    expect(screen.getByTestId('location-lng-input')).toHaveValue(-93.654);

    fireEvent.click(screen.getByTestId('location-save-btn'));

    await waitFor(() => {
      expect(mockedLocationsAPI.create).toHaveBeenCalledWith({
        city_name: 'Des Moines, IA',
        drive_time_minutes: 42,
        address: '2210 Grand Ave, Des Moines, IA 50312, USA',
        latitude: 41.5868,
        longitude: -93.654,
      });
    });
  });

  it('allows manual address entry without coordinates when maps are unavailable', async () => {
    process.env.VITE_GOOGLE_MAPS_API_KEY = '';

    renderManager();
    fireEvent.click(screen.getByTestId('add-location-btn'));

    expect(screen.queryByRole('button', { name: 'Use mocked address' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('location-lat-input')).not.toBeInTheDocument();

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
    expect(mockedManagerApi.locations.getDriveTimeFromHub).not.toHaveBeenCalled();
  });
});

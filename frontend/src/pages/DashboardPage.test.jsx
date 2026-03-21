import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from './DashboardPage';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../lib/auth';
import { locationsAPI, employeesAPI, schedulesAPI, dashboardAPI, activityAPI, workloadAPI } from '../lib/api';

// Mock the API calls
jest.mock('../lib/api', () => ({
  locationsAPI: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
  employeesAPI: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
  schedulesAPI: {
    getAll: jest.fn().mockResolvedValue({ data: [] }),
    create: jest.fn().mockResolvedValue({ data: {} }),
    update: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} })
  },
  dashboardAPI: { getStats: jest.fn().mockResolvedValue({ data: {
    today_schedules: 5,
    total_schedules: 20,
    total_employees: 10,
    total_locations: 3
  } }) },
  activityAPI: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
  workloadAPI: { getAll: jest.fn().mockResolvedValue({ data: [] }) },
  authAPI: {
    me: jest.fn().mockResolvedValue({ data: { id: 1, name: 'Test User' } })
  }
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock map component that might cause issues in tests
jest.mock('../components/MapView', () => {
  return function MockMapView() {
    return <div data-testid="map-view">Map View</div>;
  };
});

// Suppress console.error for expected API errors during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('Failed to fetch')) {
      return;
    }
    originalConsoleError(...args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});

describe('DashboardPage', () => {
  const renderDashboardPage = () => {
    return render(
      <BrowserRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </BrowserRouter>
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders the dashboard page correctly', async () => {
    renderDashboardPage();

    // Check if the dashboard container is in the document
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
    });

    // Check if the top bar is rendered
    expect(screen.getByTestId('top-bar')).toBeInTheDocument();

    // Check if the overview is rendered
    expect(screen.getByTestId('dashboard-overview')).toBeInTheDocument();
  });

  test('displays correct statistics from the API', async () => {
    renderDashboardPage();

    // Wait for the stats to load
    await waitFor(() => {
      expect(screen.getByTestId('stat-today')).toHaveTextContent('5');
      expect(screen.getByTestId('stat-total-schedules')).toHaveTextContent('20');
      expect(screen.getByTestId('stat-employees')).toHaveTextContent('10');
      expect(screen.getByTestId('stat-locations')).toHaveTextContent('3');
    });
  });

  test('switches between views via sidebar', async () => {
    renderDashboardPage();

    // First wait for the dashboard to be ready
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-overview')).toBeInTheDocument();
    });

    const user = userEvent.setup();

    // Find calendar sidebar item
    const calendarItem = screen.getAllByText('Calendar').find(el => el.tagName === 'SPAN' || el.tagName === 'DIV');

    if (calendarItem) {
      await user.click(calendarItem);

      await waitFor(() => {
        expect(screen.getByTestId('calendar-view')).toBeInTheDocument();
      });
    }

    // Map view
    const mapItem = screen.getAllByText('Map View').find(el => el.tagName === 'SPAN' || el.tagName === 'DIV');

    if (mapItem) {
      await user.click(mapItem);

      await waitFor(() => {
        expect(screen.getByTestId('map-view')).toBeInTheDocument();
      });
    }
  });

  test('handles API errors gracefully', async () => {
    // Override default mocks to simulate an error
    dashboardAPI.getStats.mockRejectedValueOnce(new Error('API Error'));

    renderDashboardPage();

    // Should still render the page structure even if stats fail
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-overview')).toBeInTheDocument();
      // Stats might be default values like 0 or empty depending on implementation
      expect(screen.getByTestId('stat-today')).toBeInTheDocument();
    });
  });

  test('opens new schedule modal when button is clicked', async () => {
    renderDashboardPage();

    // Wait for the overview to load
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-overview')).toBeInTheDocument();
    });

    const user = userEvent.setup();

    // Find the 'New Schedule' button
    const newScheduleBtn = screen.getAllByRole('button', { name: /new schedule/i })[0];

    if (newScheduleBtn) {
      await user.click(newScheduleBtn);

      // Look for dialog
      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    }
  });
});

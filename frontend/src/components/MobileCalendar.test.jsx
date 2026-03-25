import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MobileCalendar from './MobileCalendar';

jest.mock('embla-carousel-react', () => {
  return () => [null, { on: jest.fn(), off: jest.fn(), selectedScrollSnap: jest.fn() }];
});

// Mock ResizeObserver for vaul/radix components
globalThis.ResizeObserver = class ResizeObserver {
  observe() { /* no-op mock */ }
  unobserve() { /* no-op mock */ }
  disconnect() { /* no-op mock */ }
};

// MatchMedia mock
globalThis.matchMedia = globalThis.matchMedia || function() {
    return {
        matches: false,
        addListener: function() {},
        removeListener: function() {}
    };
};

describe('MobileCalendar', () => {
  it('renders the calendar view', () => {
    const mockDate = new Date('2023-10-10T12:00:00Z');
    render(
      <MobileCalendar
        currentDate={mockDate}
        setCurrentDate={jest.fn()}
        schedules={[]}
      />
    );
    expect(screen.getByText('October 10, 2023')).toBeInTheDocument();
  });
});

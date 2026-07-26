import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFound from './NotFound';

describe('NotFound', () => {
  it('renders a visible 404 instead of a blank screen', () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(screen.getByTestId('not-found-code')).toHaveTextContent('404');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });

  it('announces itself to assistive tech', () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers a way back into the app', () => {
    render(<MemoryRouter><NotFound /></MemoryRouter>);
    expect(screen.getByTestId('not-found-home-link')).toHaveAttribute('href', '/');
  });
});

# HubSpoke - Frontend

React 19 + TypeScript + Vite frontend for the HubSpoke scheduling platform.

## Tech Stack

- **React 19** with TypeScript
- **Vite 5** for build tooling
- **Tailwind CSS 3** for styling
- **Radix UI / shadcn** for accessible UI components
- **SWR** for data fetching and caching
- **React Hook Form + Zod** for form handling and validation
- **React Router 7** for URL-based routing
- **Recharts** for analytics charts
- **@dnd-kit** for drag-and-drop interactions

## Available Scripts

### `npm start`

Runs the Vite dev server at [http://localhost:5173](http://localhost:5173) with hot module replacement.

### `npm run build`

Builds the production bundle to the `dist/` directory. Uses Vite with code splitting and lazy loading.

### `npm run preview`

Serves the production build locally for testing.

### `npm test`

Runs the test suite using Jest and @testing-library/react.

## Project Structure

```
src/
  components/     # UI components (calendar views, managers, analytics)
  components/ui/  # shadcn/ui base components
  hooks/          # Custom React hooks (data fetching, forms, etc.)
  lib/            # Core utilities (api.ts, auth.tsx, types.ts, constants.ts)
  pages/          # Page-level components (LoginPage, DashboardPage)
```

## Environment Variables

- `VITE_BACKEND_URL` - Backend API URL (defaults to same origin)
- `VITE_GOOGLE_MAPS_API_KEY` - Google Maps API key for map view
- `VITE_SENTRY_DSN` - Sentry DSN for error tracking (optional)

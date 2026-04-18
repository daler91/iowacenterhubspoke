import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ErrorBoundary from "./components/ErrorBoundary";

/**
 * Wraps a route element in an ErrorBoundary keyed on the current path so a
 * render error on one page is scoped to that route and clears when the user
 * navigates away. Use this for every page element instead of a single
 * shell-level boundary.
 */
function RouteBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

function ProtectedRoute({ children }: Readonly<{ children: ReactNode }>) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
}

/**
 * Role-gated route. Renders a not-authorised notice (inside the main
 * shell, so the sidebar stays visible) when the user lacks the
 * required role. Does NOT redirect — just blocks rendering of the
 * page content. Catches the "scheduler lands on /users via deep
 * link" case where the component's internal check would otherwise
 * only show after the API call 403s.
 */
function RoleGate({
  allowed,
  children,
}: Readonly<{ allowed: readonly string[]; children: ReactNode }>) {
  const { user } = useAuth();
  if (!user || !allowed.includes(user.role)) {
    return (
      <div
        className="p-8 text-center"
        role="alert"
        aria-live="polite"
      >
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-2">
          Not authorised
        </h2>
        <p className="text-sm text-muted-foreground">
          This page is only available to {allowed.join(' or ')} accounts.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const MapView = lazy(() => import("./components/MapView"));
const KanbanBoard = lazy(() => import("./components/KanbanBoard"));
const CalendarView = lazy(() => import("./components/CalendarView"));
const LocationManager = lazy(() => import("./components/LocationManager"));
const EmployeeManager = lazy(() => import("./components/EmployeeManager"));
const ClassManager = lazy(() => import("./components/ClassManager"));
const InsightsPage = lazy(() => import("./components/InsightsPage"));
const UserManager = lazy(() => import("./components/UserManager"));
const EmployeeProfile = lazy(() => import("./components/EmployeeProfile"));
const LocationProfile = lazy(() => import("./components/LocationProfile"));
const ClassProfile = lazy(() => import("./components/ClassProfile"));
const PersonalSettings = lazy(() => import("./components/PersonalSettings"));
const CommunityDashboard = lazy(() => import("./pages/CommunityDashboard"));
const ProjectBoard = lazy(() => import("./components/coordination/ProjectBoard"));
const ProjectDetail = lazy(() => import("./components/coordination/ProjectDetail"));
const PartnerManager = lazy(() => import("./components/coordination/PartnerManager"));
const PartnerProfile = lazy(() => import("./components/coordination/PartnerProfile"));
const PortalDashboard = lazy(() => import("./components/portal/PortalDashboard"));
const WebhookManager = lazy(() => import("./components/coordination/WebhookManager"));

function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] dark:bg-gray-950">
          <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }>
        <Routes>
          <Route path="/login" element={
            <PublicRoute><LoginPage /></PublicRoute>
          } />
          <Route path="/forgot-password" element={
            <PublicRoute><ForgotPasswordPage /></PublicRoute>
          } />
          <Route path="/reset-password/:token" element={
            <PublicRoute><ResetPasswordPage /></PublicRoute>
          } />
          <Route path="/" element={
            <ProtectedRoute>
              {/* Shell-level ErrorBoundary catches exceptions from shell
                  components rendered by DashboardPage OUTSIDE the
                  <Outlet /> — Sidebar, top-bar, NotificationsPanel,
                  ScheduleForm modal, StatModal. Per-route RouteBoundary
                  wrappers below cover errors inside the Outlet and
                  reset on navigation, so this is defense in depth. */}
              <ErrorBoundary>
                <DashboardPage />
              </ErrorBoundary>
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/calendar" replace />} />
            <Route path="calendar" element={<RouteBoundary><CalendarView /></RouteBoundary>} />
            <Route path="kanban" element={<RouteBoundary><KanbanBoard /></RouteBoundary>} />
            <Route path="insights" element={<RouteBoundary><InsightsPage /></RouteBoundary>} />
            <Route path="workload" element={<Navigate to="/insights?tab=workload" replace />} />
            <Route path="report" element={<Navigate to="/insights?tab=summary" replace />} />
            <Route path="analytics" element={<Navigate to="/insights?tab=analytics" replace />} />
            <Route path="activity" element={<Navigate to="/insights?tab=activity" replace />} />
            <Route path="map" element={<RouteBoundary><MapView /></RouteBoundary>} />
            <Route path="locations" element={<RouteBoundary><LocationManager /></RouteBoundary>} />
            <Route path="classes" element={<RouteBoundary><ClassManager /></RouteBoundary>} />
            <Route path="employees" element={<RouteBoundary><EmployeeManager /></RouteBoundary>} />
            <Route path="employees/:id" element={<RouteBoundary><EmployeeProfile /></RouteBoundary>} />
            <Route path="locations/:id" element={<RouteBoundary><LocationProfile /></RouteBoundary>} />
            <Route path="classes/:id" element={<RouteBoundary><ClassProfile /></RouteBoundary>} />
            <Route path="users" element={
              <RouteBoundary>
                <RoleGate allowed={['admin']}><UserManager /></RoleGate>
              </RouteBoundary>
            } />
            <Route path="settings" element={<RouteBoundary><PersonalSettings /></RouteBoundary>} />
            <Route path="coordination" element={<RouteBoundary><CommunityDashboard /></RouteBoundary>} />
            <Route path="coordination/board" element={<RouteBoundary><ProjectBoard /></RouteBoundary>} />
            <Route path="coordination/projects/:id" element={<RouteBoundary><ProjectDetail /></RouteBoundary>} />
            <Route path="coordination/partners" element={
              <RouteBoundary>
                <RoleGate allowed={['admin', 'scheduler']}><PartnerManager /></RoleGate>
              </RouteBoundary>
            } />
            <Route path="coordination/partners/:id" element={
              <RouteBoundary>
                <RoleGate allowed={['admin', 'scheduler']}><PartnerProfile /></RoleGate>
              </RouteBoundary>
            } />
            <Route path="coordination/webhooks" element={
              <RouteBoundary>
                <RoleGate allowed={['admin']}><WebhookManager /></RoleGate>
              </RouteBoundary>
            } />
          </Route>
          <Route path="/portal/:token" element={<RouteBoundary><PortalDashboard /></RouteBoundary>} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <AuthProvider>
        <AppRoutes />
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;

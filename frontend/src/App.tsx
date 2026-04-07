import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ErrorBoundary from "./components/ErrorBoundary";

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

function PublicRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

const MapView = lazy(() => import("./components/MapView"));
const WorkloadDashboard = lazy(() => import("./components/WorkloadDashboard"));
const KanbanBoard = lazy(() => import("./components/KanbanBoard"));
const WeeklyReport = lazy(() => import("./components/WeeklyReport"));
const CalendarView = lazy(() => import("./components/CalendarView"));
const LocationManager = lazy(() => import("./components/LocationManager"));
const EmployeeManager = lazy(() => import("./components/EmployeeManager"));
const ClassManager = lazy(() => import("./components/ClassManager"));
const ActivityFeed = lazy(() => import("./components/ActivityFeed"));
const AdvancedAnalytics = lazy(() => import("./components/AdvancedAnalytics"));
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
          <Route path="/" element={
            <ProtectedRoute>
              <ErrorBoundary>
                <DashboardPage />
              </ErrorBoundary>
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/calendar" replace />} />
            <Route path="calendar" element={<CalendarView />} />
            <Route path="kanban" element={<KanbanBoard />} />
            <Route path="workload" element={<WorkloadDashboard />} />
            <Route path="report" element={<WeeklyReport />} />
            <Route path="analytics" element={<AdvancedAnalytics />} />
            <Route path="activity" element={<ActivityFeed />} />
            <Route path="map" element={<MapView />} />
            <Route path="locations" element={<LocationManager />} />
            <Route path="classes" element={<ClassManager />} />
            <Route path="employees" element={<EmployeeManager />} />
            <Route path="employees/:id" element={<EmployeeProfile />} />
            <Route path="locations/:id" element={<LocationProfile />} />
            <Route path="classes/:id" element={<ClassProfile />} />
            <Route path="users" element={<UserManager />} />
            <Route path="settings" element={<PersonalSettings />} />
            <Route path="coordination" element={<CommunityDashboard />} />
            <Route path="coordination/board" element={<ProjectBoard />} />
            <Route path="coordination/projects/:id" element={<ProjectDetail />} />
            <Route path="coordination/partners" element={<PartnerManager />} />
            <Route path="coordination/partners/:id" element={<PartnerProfile />} />
            <Route path="coordination/webhooks" element={<WebhookManager />} />
          </Route>
          <Route path="/portal/:token" element={<PortalDashboard />} />
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

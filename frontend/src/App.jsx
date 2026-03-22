import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PropTypes from "prop-types";
import { Toaster } from "./components/ui/sonner";
import { AuthProvider, useAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ErrorBoundary from "./components/ErrorBoundary";

/** @param {{ children: React.ReactNode }} props */
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
}

ProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

/** @param {{ children: React.ReactNode }} props */
function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <Navigate to="/" replace /> : children;
}

PublicRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

import { lazy, Suspense } from "react";

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

function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB]">
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
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
      <Toaster position="top-right" richColors />
    </AuthProvider>
  );
}

export default App;

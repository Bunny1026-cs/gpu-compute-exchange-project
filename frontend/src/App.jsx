/**
 * App.jsx — GPU Compute Exchange
 * Phase 4: Full routing with auth, consumer, and provider pages.
 */
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./routes/ProtectedRoute";
import Navbar        from "./components/Navbar";

// Pages
import LandingPage         from "./pages/LandingPage";
import Login               from "./pages/Login";
import Register            from "./pages/Register";
import ConsumerDashboard   from "./pages/ConsumerDashboard";
import ConsumerJobs        from "./pages/ConsumerJobs";
import ProviderDashboard   from "./pages/ProviderDashboard";
import ProviderJobs        from "./pages/ProviderJobs";

import "./App.css";

/** Root redirect — sends authenticated users to their dashboard */
function HomeRedirect() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return null;
  if (isAuthenticated) return <Navigate to={user?.role === "PROVIDER" ? "/provider" : "/consumer"} replace />;
  return <LandingPage />;
}

/** Redirect logged-in users away from login/register */
function AuthRedirect({ children }) {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return null;
  if (isAuthenticated) return <Navigate to={user?.role === "PROVIDER" ? "/provider" : "/consumer"} replace />;
  return children;
}

function AppRoutes() {
  return (
    <>
      <Navbar />
      <main>
        <Routes>
          {/* Public */}
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login"    element={<AuthRedirect><Login /></AuthRedirect>} />
          <Route path="/register" element={<AuthRedirect><Register /></AuthRedirect>} />

          {/* Consumer */}
          <Route element={<ProtectedRoute requiredRole="CONSUMER" />}>
            <Route path="/consumer"      element={<ConsumerDashboard />} />
            <Route path="/consumer/jobs" element={<ConsumerJobs />} />
          </Route>

          {/* Provider */}
          <Route element={<ProtectedRoute requiredRole="PROVIDER" />}>
            <Route path="/provider"      element={<ProviderDashboard />} />
            <Route path="/provider/gpus" element={<ProviderDashboard />} />
            <Route path="/provider/jobs" element={<ProviderJobs />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

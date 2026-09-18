/**
 * routes/ProtectedRoute.jsx
 * Route guard for authenticated + role-restricted pages.
 *
 * Usage:
 *   <ProtectedRoute requiredRole="CONSUMER" />  — consumer dashboard
 *   <ProtectedRoute requiredRole="PROVIDER" />  — provider dashboard
 *   <ProtectedRoute />                          — any authenticated user
 */

import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ requiredRole }) {
  const { isAuthenticated, user, loading } = useAuth();

  // Wait until session is restored before making redirect decisions
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading session…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Role-based guard: redirect to the correct dashboard
  if (requiredRole && user?.role !== requiredRole) {
    const redirect = user?.role === "PROVIDER" ? "/provider" : "/consumer";
    return <Navigate to={redirect} replace />;
  }

  return <Outlet />;
}

/**
 * context/AuthContext.jsx
 * Authentication state management — GPU Compute Exchange
 *
 * Provides: user, token, isAuthenticated, login(), logout(), register()
 * Restores session from localStorage on app load.
 * Never stores sensitive backend secrets — only the session JWT.
 */

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { authAPI } from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]   = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true); // true while restoring session

  // ── Restore session from localStorage ────────────────────────
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem("token");
      const storedUser  = localStorage.getItem("user");
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch {
      // Corrupted storage — clear it
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Persist session ───────────────────────────────────────────
  const persistSession = useCallback((newToken, newUser) => {
    localStorage.setItem("token", newToken);
    localStorage.setItem("user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  // ── register ──────────────────────────────────────────────────
  const register = useCallback(async (payload) => {
    const data = await authAPI.register(payload); // throws on error
    persistSession(data.token, data.user);
    return data.user;
  }, [persistSession]);

  // ── login ─────────────────────────────────────────────────────
  const login = useCallback(async (payload) => {
    const data = await authAPI.login(payload); // throws on error
    persistSession(data.token, data.user);
    return data.user;
  }, [persistSession]);

  // ── logout ────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setToken(null);
    setUser(null);
  }, []);

  const value = {
    user,
    token,
    isAuthenticated: !!token && !!user,
    loading,
    login,
    logout,
    register,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

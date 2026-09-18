/**
 * services/api.js
 * Centralized API client — GPU Compute Exchange Frontend
 *
 * All backend calls go through this module.
 * Base URL is read from VITE_API_URL — never hard-coded.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

/**
 * apiFetch
 * Core fetch wrapper — injects auth token, handles JSON, normalises errors.
 */
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("token");

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({ success: false, message: "Invalid server response." }));

  if (!res.ok) {
    // Throw with the server's message so callers can display it directly
    throw Object.assign(new Error(data.message || "Request failed."), {
      status: res.status,
      data,
    });
  }

  return data;
}

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  register: (payload) =>
    apiFetch("/auth/register", { method: "POST", body: JSON.stringify(payload) }),

  login: (payload) =>
    apiFetch("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
};

// ── GPUs ──────────────────────────────────────────────────────
export const gpuAPI = {
  /** Marketplace list — available GPUs. Pass ?mine=true for provider's own GPUs */
  list: (params = "") =>
    apiFetch(`/gpus${params}`),

  get: (id) =>
    apiFetch(`/gpus/${id}`),

  create: (payload) =>
    apiFetch("/gpus", { method: "POST", body: JSON.stringify(payload) }),

  update: (id, payload) =>
    apiFetch(`/gpus/${id}`, { method: "PUT", body: JSON.stringify(payload) }),

  delete: (id) =>
    apiFetch(`/gpus/${id}`, { method: "DELETE" }),
};

// ── Jobs ──────────────────────────────────────────────────────
export const jobAPI = {
  list: () =>
    apiFetch("/jobs"),

  get: (id) =>
    apiFetch(`/jobs/${id}`),

  result: (id) =>
    apiFetch(`/jobs/${id}/result`),

  create: (payload) =>
    apiFetch("/jobs", { method: "POST", body: JSON.stringify(payload) }),
};

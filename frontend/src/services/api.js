/**
 * services/api.js
 * Centralized API client — GPU Compute Exchange Frontend
 *
 * All backend calls go through this module.
 * Base URL is read from VITE_API_URL — never hard-coded.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "/api";

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
export const computeAPI = { config: () => apiFetch("/compute/config") };
export const batchAPI = {
  pairCode: () => apiFetch("/agents/code", { method: "POST" }),
  share: (id, rate, enabled) => apiFetch("/agents/slots/" + id, {method:"PUT",body:JSON.stringify({rate,enabled})}),
  create: data => apiFetch("/batch/jobs",{method:"POST",body:JSON.stringify(data)}),
  quote: id => apiFetch("/jobs/" + id + "/quote",{method:"POST"}),
  repeat: id => apiFetch("/jobs/" + id + "/repeat",{method:"POST"}),
  review: (id,decision,reason) => apiFetch("/jobs/" + id + "/review",{method:"POST",body:JSON.stringify({decision,reason})}),
  download: async (id,name) => {
    const response = await fetch(BASE_URL + "/jobs/" + id + "/outputs/" + encodeURIComponent(name), {
      headers:{Authorization:"Bearer " + localStorage.getItem("token")}
    });
    if (!response.ok) throw new Error("Output download failed");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href=url; link.download=name; link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
};
export const gpuAPI = {
  workerKey: (id, walletAddress) => apiFetch(`/gpus/${id}/worker-key`, { method: "POST", body: JSON.stringify({ walletAddress }) }),
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
  fund: (id) => apiFetch(`/jobs/${id}/fund`, { method: "POST" }),
  cancel: (id) => apiFetch(`/jobs/${id}/cancel`, { method: "POST" }),
  reconcile: (id) => apiFetch(`/jobs/${id}/reconcile`, { method: "POST" }),
  artifact: async (id) => {
    const response = await fetch(`${BASE_URL}/jobs/${id}/artifact`, { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
    if (!response.ok) throw new Error((await response.json()).message || "Download failed");
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${id}.npy`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  list: () =>
    apiFetch("/jobs"),

  get: (id) =>
    apiFetch(`/jobs/${id}`),

  result: (id) =>
    apiFetch(`/jobs/${id}/result`),

  create: (payload) =>
    apiFetch("/jobs", { method: "POST", body: JSON.stringify(payload) }),
};

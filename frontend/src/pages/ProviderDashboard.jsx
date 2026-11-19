/**
 * pages/ProviderDashboard.jsx
 * Provider dashboard — manage GPUs
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gpuAPI } from "../services/api";
import Modal from "../components/Modal";
import { PairAgent, DeviceSettings } from "../components/AgentSettings";
import WorkerSetup from "../components/WorkerSetup";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

const EMPTY_FORM = { gpuModel: "", gpuMemory: "", cudaVersion: "", pricePerHour: "", availability: true, status: "ACTIVE" };
// P0-4: BUSY is set only by the scheduler/worker lifecycle, never by providers.
const GPU_STATUSES = ["ACTIVE", "INACTIVE"];

export default function ProviderDashboard() {
  const { user } = useAuth();
  const [gpus, setGpus]         = useState([]);
  const [loading, setL]         = useState(true);
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");

  // Form state — null = hidden, {} = new, {_id:...} = editing
  const [formMode, setFormMode] = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [formError, setFE]      = useState("");

  const fetchMyGPUs = useCallback(async () => {
    setError("");
    try {
      const res = await gpuAPI.list("?mine=true");
      setGpus(res.data || []);
    } catch (err) { setError(err.message); }
    finally { setL(false); }
  }, []);

  useEffect(() => { fetchMyGPUs(); const timer = setInterval(fetchMyGPUs, 5000); return () => clearInterval(timer); }, [fetchMyGPUs]);

  const openNew = async () => {
    try { await gpuAPI.create({}); setSuccess("Slot registered. Configure a worker credential below, then start the worker."); await fetchMyGPUs(); }
    catch (error) { setError(error.message); }
  };
  const openEdit = (gpu) => {
    setForm({ gpuModel: gpu.gpuModel, gpuMemory: gpu.gpuMemory, cudaVersion: gpu.cudaVersion,
              pricePerHour: gpu.pricePerHour, availability: gpu.availability, status: gpu.status });
    setFormMode(gpu._id); setFE("");
  };
  const closeForm = () => { setFormMode(null); setFE(""); };
  const editingBusy = formMode !== null && formMode !== "new" && form.status === "BUSY";

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.gpuModel.trim()) return setFE("GPU model is required.");
    if (!form.cudaVersion.trim()) return setFE("CUDA version is required.");

    setSaving(true); setFE("");
    try {
      const payload = { status: form.status, availability: form.availability };
      // P0-4: status/availability of a BUSY GPU are locked by the backend.
      if (editingBusy) { delete payload.status; delete payload.availability; }
      if (formMode === "new") {
        await gpuAPI.create(payload);
        setSuccess("GPU registered successfully!");
      } else {
        await gpuAPI.update(formMode, payload);
        setSuccess("GPU updated successfully!");
      }
      closeForm();
      fetchMyGPUs();
    } catch (err) { setFE(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this GPU? This cannot be undone.")) return;
    try {
      await gpuAPI.delete(id);
      setSuccess("GPU deleted.");
      fetchMyGPUs();
    } catch (err) { setError(err.message); }
  };

  const toggleAvailability = async (gpu) => {
    try {
      await gpuAPI.update(gpu._id, { availability: !gpu.availability });
      setSuccess(`GPU marked as ${!gpu.availability ? "Available" : "Unavailable"}.`);
      fetchMyGPUs();
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div><h1 className="page-title">Provider dashboard</h1>
        <p className="page-subtitle">Manage worker availability and settings for {user?.name}.</p></div>
      </div>

      <Alert type="success" message={success} onClose={() => setSuccess("")} />
      <Alert type="error"   message={error}   onClose={() => setError("")} />

      <PairAgent />
      {/* Stats strip */}
      {!loading && !error && <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{gpus.length}</div>
          <div className="stat-label">Registered GPUs</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{gpus.filter(g => g.online && g.availability && g.status === "ACTIVE").length}</div>
          <div className="stat-label">Available</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{gpus.filter(g => g.online).length}</div>
          <div className="stat-label">Workers online</div>
        </div>
      </div>}

      <div className="section-header">
        <h2 className="section-label">My GPUs</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchMyGPUs} disabled={loading}>↻ Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={openNew}>+ Register GPU</button>
        </div>
      </div>

      {loading && <Spinner text="Loading your GPUs…" />}

      {!loading && !error && gpus.length === 0 && (
        <div className="empty-state">
          <p>No GPUs registered yet.</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openNew}>Register Your First GPU</button>
        </div>
      )}

      {/* GPU cards */}
      <div className="gpu-grid provider">
        {gpus.map((gpu) => (
          <div key={gpu._id} data-slot-id={gpu._id} className="gpu-card provider-gpu">
            <div className="gpu-card-header">
              <span className="gpu-model">{gpu.gpuModel}</span>
              <span className={`gpu-badge ${gpu.availability ? "available" : "unavailable"}`}>
                {gpu.availability ? "Listed" : "Unlisted"}
              </span>
            </div>
            <div className="gpu-specs">
              {gpu.executionMode === "real_gpu" && <><span>{gpu.gpuMemory} GB</span><span>CUDA {gpu.cudaVersion}</span></>}
              <span>Slot status · {gpu.status}</span>
            </div>
            {gpu.agentId ? <DeviceSettings gpu={gpu} refresh={fetchMyGPUs} /> : <WorkerSetup gpu={gpu} refresh={fetchMyGPUs} />}

            {!gpu.agentId && <div className="gpu-actions">
              <button disabled={gpu.status === "BUSY"} className="btn btn-ghost btn-xs" onClick={() => openEdit(gpu)}>Edit</button>
              <button className="btn btn-ghost btn-xs" onClick={() => toggleAvailability(gpu)}
                disabled={gpu.status === "BUSY"} title={gpu.status === "BUSY" ? "Locked while a job is assigned or running" : undefined}>
                {gpu.availability ? "Unlist" : "List"}
              </button>
              <button className="btn btn-danger btn-xs" onClick={() => handleDelete(gpu._id)}
                disabled={gpu.status === "BUSY"} title={gpu.status === "BUSY" ? "Locked while a job is assigned or running" : undefined}>Delete</button>
            </div>}
          </div>
        ))}
      </div>

      {/* GPU Form Modal */}
      {formMode !== null && (
        <Modal title={formMode === "new" ? "Register new GPU" : "Edit GPU settings"} onClose={closeForm}>
            <Alert type="error" message={formError} onClose={() => setFE("")} />
            <form onSubmit={handleSave} className="auth-form">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="gpuModel">GPU Model *</label>
                  <input className="form-input" id="gpuModel" name="gpuModel" value={form.gpuModel} onChange={handleChange} placeholder="e.g. RTX 4090" required disabled={saving || formMode !== "new"} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="gpuMemory">Memory (GB) *</label>
                  <input className="form-input" type="number" id="gpuMemory" name="gpuMemory" value={form.gpuMemory} onChange={handleChange} placeholder="24" min="1" required disabled={saving || formMode !== "new"} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="cudaVersion">CUDA Version *</label>
                  <input className="form-input" id="cudaVersion" name="cudaVersion" value={form.cudaVersion} onChange={handleChange} placeholder="12.2" required disabled={saving || formMode !== "new"} />
                </div>
                <div className="form-group">
                  <label className="form-label">Pricing</label>
                  <p>Consumers reserve minutes at the configured demo-wallet rate.</p>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="status">Status</label>
                  <select className="form-input" id="status" name="status" value={form.status} onChange={handleChange} disabled={saving || editingBusy}>
                    {editingBusy
                      ? <option value="BUSY">BUSY (managed by scheduler)</option>
                      : GPU_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ justifyContent: "center" }}>
                  <label className="form-label">List on Marketplace</label>
                  <label className="toggle-label">
                    <input type="checkbox" name="availability" checked={form.availability} onChange={handleChange} disabled={saving || editingBusy} />
                    <span className="toggle-text">{form.availability ? "Available" : "Unavailable"}</span>
                  </label>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? "Saving…" : formMode === "new" ? "Register GPU" : "Save Changes"}
                </button>
                <button className="btn btn-ghost" type="button" onClick={closeForm} disabled={saving}>Cancel</button>
              </div>
            </form>
        </Modal>
      )}

      <div className="quick-links">
        <Link to="/provider/jobs" className="btn btn-ghost">Jobs on My GPUs</Link>
      </div>
    </div>
  );
}

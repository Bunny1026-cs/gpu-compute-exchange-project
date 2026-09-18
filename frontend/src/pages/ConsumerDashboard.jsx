/**
 * pages/ConsumerDashboard.jsx
 * Consumer Dashboard — Phase 5
 *
 * Changes from Phase 4:
 *   - Consumer no longer selects a specific GPU to submit a job.
 *   - Consumer provides requirements (memory, CUDA, maxPrice).
 *   - The scheduler automatically assigns the best compatible GPU.
 *   - GPU marketplace is now an informational browse panel.
 *   - Jobs show QUEUED and ASSIGNED statuses.
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { gpuAPI, jobAPI } from "../services/api";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

export default function ConsumerDashboard() {
  const { user } = useAuth();

  // ── GPU marketplace (informational) ───────────────────────────
  const [gpus, setGpus]      = useState([]);
  const [gpusLoading, setGL] = useState(true);
  const [gpusError, setGE]   = useState("");

  // ── Job requirements form ─────────────────────────────────────
  const [jobForm, setJobForm] = useState({
    taskType: "",
    requiredGpuMemory: "",
    requiredCudaVersion: "",
    maximumPrice: "",
    price: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [jobSuccess, setJobSuccess] = useState(null);
  const [jobError, setJobError]     = useState("");

  const fetchGPUs = useCallback(async () => {
    setGL(true); setGE("");
    try {
      const res = await gpuAPI.list();
      setGpus(res.data || []);
    } catch (err) { setGE(err.message); }
    finally { setGL(false); }
  }, []);

  useEffect(() => { fetchGPUs(); }, [fetchGPUs]);

  const handleChange = (e) => setJobForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!jobForm.price) return setJobError("Budget (price) is required.");
    setSubmitting(true); setJobError(""); setJobSuccess(null);
    try {
      const requirements = {};
      if (jobForm.requiredGpuMemory) requirements.requiredGpuMemory = Number(jobForm.requiredGpuMemory);
      if (jobForm.requiredCudaVersion.trim()) requirements.requiredCudaVersion = jobForm.requiredCudaVersion.trim();
      if (jobForm.maximumPrice) requirements.maximumPrice = Number(jobForm.maximumPrice);

      const payload = {
        taskType: jobForm.taskType || "inference",
        price: Number(jobForm.price),
      };
      if (Object.keys(requirements).length > 0) payload.requirements = requirements;

      const res = await jobAPI.create(payload);
      setJobSuccess(res.data);
      setJobForm({ taskType: "", requiredGpuMemory: "", requiredCudaVersion: "", maximumPrice: "", price: "" });
    } catch (err) { setJobError(err.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Consumer Dashboard</h1>
          <p className="page-subtitle">Welcome, <strong>{user?.name}</strong> — submit GPU compute jobs.</p>
        </div>
        <Link to="/consumer/jobs" className="btn btn-ghost btn-sm">📋 View My Jobs</Link>
      </div>

      {jobSuccess && (
        <Alert type="success"
          message={`✅ Job submitted! ID: ${jobSuccess._id} — Status: ${jobSuccess.status}. The scheduler will assign a GPU automatically.`}
          onClose={() => setJobSuccess(null)} />
      )}

      <div className="dashboard-grid">
        {/* ── Job Submission Form ── */}
        <section className="dash-section">
          <h2 className="section-label">Submit a Compute Job</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 20 }}>
            Specify your requirements. The scheduler will automatically select the best compatible GPU.
          </p>

          <Alert type="error" message={jobError} onClose={() => setJobError("")} />

          <form onSubmit={handleSubmit} className="job-form">
            <div className="form-group">
              <label className="form-label">Task Type</label>
              <input className="form-input" name="taskType" value={jobForm.taskType}
                onChange={handleChange} placeholder="e.g. inference, training, fine-tuning" disabled={submitting} />
            </div>

            <div className="form-notice">
              <span>⚙️</span>
              <strong>GPU Requirements (optional)</strong>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Min GPU Memory (GB)</label>
                <input className="form-input" type="number" name="requiredGpuMemory" value={jobForm.requiredGpuMemory}
                  onChange={handleChange} placeholder="e.g. 16" min="0" disabled={submitting} />
              </div>
              <div className="form-group">
                <label className="form-label">Min CUDA Version</label>
                <input className="form-input" name="requiredCudaVersion" value={jobForm.requiredCudaVersion}
                  onChange={handleChange} placeholder="e.g. 12.0" disabled={submitting} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Max Price/hr (₹)</label>
                <input className="form-input" type="number" name="maximumPrice" value={jobForm.maximumPrice}
                  onChange={handleChange} placeholder="e.g. 100" min="0" disabled={submitting} />
              </div>
              <div className="form-group">
                <label className="form-label">Your Budget (₹) <span style={{color:"var(--danger)"}}>*</span></label>
                <input className="form-input" type="number" name="price" value={jobForm.price}
                  onChange={handleChange} placeholder="Total budget" min="0" required disabled={submitting} />
              </div>
            </div>

            <div className="form-notice">
              <span>ℹ️</span>
              <span>Job will be <strong>QUEUED</strong> immediately. The scheduler assigns a GPU and moves it to <strong>ASSIGNED</strong>.</span>
            </div>

            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Job →"}
            </button>
          </form>
        </section>

        {/* ── GPU Marketplace (informational) ── */}
        <section className="dash-section">
          <div className="section-header">
            <h2 className="section-label">Available GPUs</h2>
            <button className="btn btn-ghost btn-sm" onClick={fetchGPUs} disabled={gpusLoading}>↻</button>
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 16 }}>
            Reference only — the scheduler automatically picks the best match for your requirements.
          </p>

          {gpusLoading && <Spinner text="Loading GPUs…" />}
          {gpusError  && <Alert type="error" message={gpusError} />}

          {!gpusLoading && gpus.length === 0 && (
            <div className="empty-state" style={{ padding: "30px 0" }}>
              <span>🖥️</span>
              <p>No GPUs available right now.</p>
            </div>
          )}

          <div className="gpu-grid">
            {gpus.map((gpu) => (
              <div key={gpu._id} className="gpu-card" style={{ cursor: "default" }}>
                <div className="gpu-card-header">
                  <span className="gpu-model">{gpu.gpuModel}</span>
                  <span className={`gpu-badge ${gpu.availability && gpu.status === "ACTIVE" ? "available" : "unavailable"}`}>
                    {gpu.status === "BUSY" ? "Busy" : gpu.availability ? "Available" : "Unavailable"}
                  </span>
                </div>
                <div className="gpu-specs">
                  <span>💾 {gpu.gpuMemory} GB</span>
                  <span>⚡ CUDA {gpu.cudaVersion}</span>
                </div>
                <div className="gpu-price">₹{gpu.pricePerHour}/hr</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

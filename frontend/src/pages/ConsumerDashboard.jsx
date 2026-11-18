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
import { gpuAPI, jobAPI, computeAPI } from "../services/api";
import ComputeJobActions from "../components/ComputeJobActions";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

export default function ConsumerDashboard() {
  const { user } = useAuth();
  const [config, setConfig] = useState(null);
  useEffect(() => { computeAPI.config().then((res) => setConfig(res.data)).catch((error) => setJobError(error.message)); }, []);

  // ── GPU marketplace (informational) ───────────────────────────
  const [gpus, setGpus]      = useState([]);
  const [gpusLoading, setGL] = useState(true);
  const [gpusError, setGE]   = useState("");

  // ── Job requirements form ─────────────────────────────────────
  const [jobForm, setJobForm] = useState({
    taskType: "matrix_multiply", size: "128", seed: "42", reservedMinutes: "1",
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

  useEffect(() => {
    fetchGPUs();
    const timer = setInterval(fetchGPUs, 5000);
    return () => clearInterval(timer);
  }, [fetchGPUs]);

  const activeJobId = jobSuccess && !["COMPLETED", "CANCELLED", "REFUNDED", "FAILED"].includes(jobSuccess.status)
    ? jobSuccess._id : null;
  useEffect(() => {
    if (!activeJobId) return;
    let active = true;
    let timer;
    async function refresh() {
      try {
        const response = await jobAPI.get(activeJobId);
        if (active) setJobSuccess(response.data);
      } catch (error) {
        if (active) setJobError(error.message);
      } finally {
        if (active) timer = setTimeout(refresh, 3000);
      }
    }
    timer = setTimeout(refresh, 3000);
    return () => { active = false; clearTimeout(timer); };
  }, [activeJobId]);

  const handleChange = (e) => setJobForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();

    setSubmitting(true); setJobError(""); setJobSuccess(null);
    try {
      const requirements = {};
      if (jobForm.requiredGpuMemory) requirements.requiredGpuMemory = Number(jobForm.requiredGpuMemory);
      if (jobForm.requiredCudaVersion.trim()) requirements.requiredCudaVersion = jobForm.requiredCudaVersion.trim();
      if (jobForm.maximumPrice) requirements.maximumPrice = Number(jobForm.maximumPrice);

      const payload = {
        taskType: "matrix_multiply", input: { size: Number(jobForm.size), seed: Number(jobForm.seed) },
        reservedMinutes: Number(jobForm.reservedMinutes),
      };
      if (Object.keys(requirements).length > 0) payload.requirements = requirements;

      const res = await jobAPI.create(payload);
      setJobSuccess(res.data);
      setJobForm({ taskType: "matrix_multiply", size: "128", seed: "42", reservedMinutes: "1", requiredGpuMemory: "", requiredCudaVersion: "", maximumPrice: "", price: "" });
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
          message={`Job ${jobSuccess._id} · ${jobSuccess.status}`}
          onClose={() => setJobSuccess(null)} />
      )}

      <div className="dashboard-grid">
        {/* ── Job Submission Form ── */}
        <section className="dash-section">
          <h2 className="section-label">Submit a Compute Job</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 20 }}>
            Specify your requirements. The scheduler will automatically select the best compatible GPU.
          </p>

          {jobSuccess && <ComputeJobActions job={jobSuccess} consumer refresh={async () => setJobSuccess((await jobAPI.get(jobSuccess._id)).data)} />}
      <Alert type="error" message={jobError} onClose={() => setJobError("")} />

          <form onSubmit={handleSubmit} className="job-form">
            <p>{!config ? "Loading execution configuration..." : config.executionMode === "real_cpu_test" ? "CPU development test (not GPU execution)" : "Real CUDA GPU execution"} - Matrix multiplication</p>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Matrix size (2-1024)</label><input className="form-input" name="size" type="number" min="2" max="1024" value={jobForm.size} onChange={handleChange} required /></div>
              <div className="form-group"><label className="form-label">Seed</label><input className="form-input" name="seed" type="number" min="0" max="2147483647" value={jobForm.seed} onChange={handleChange} required /></div>
            </div>
            <div className="form-group"><label className="form-label">Reserved minutes (1-10)</label><input className="form-input" name="reservedMinutes" type="number" min="1" max="10" value={jobForm.reservedMinutes} onChange={handleChange} required /></div>
            <p>Rate: {config?.rateWeiPerMinute || "Loading..."} wei/min. Local Hardhat test ETH only.</p>
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

            <div className="form-notice">Submit to receive the exact quote. Funding is required before scheduling. The workload is fixed at submission.</div>

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
                <div className="gpu-price">{config?.rateWeiPerMinute} wei/min (local test ETH)</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

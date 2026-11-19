/**
 * pages/ConsumerDashboard.jsx
 * Consumer dashboard — Phase 5
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
import ScriptForm from "../components/ScriptForm";
import Spinner from "../components/Spinner";

export default function ConsumerDashboard() {
  const { user } = useAuth();
  const [workload,setWorkload] = useState("matrix");
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
    setGE("");
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
          <h1 className="page-title">Consumer dashboard</h1>
          <p className="page-subtitle">Submit workloads and review available compute for {user?.name}.</p>
        </div>
        <Link to="/consumer/jobs" className="btn btn-ghost btn-sm">View My Jobs</Link>
      </div>

      {jobSuccess && (
        <Alert type="success"
          message={`Job ${jobSuccess._id} · ${jobSuccess.status}`}
          onClose={() => setJobSuccess(null)} />
      )}

      <div className="dashboard-grid">
        {/* ── Job Submission Form ── */}
        <section className="dash-section">
          <h2 className="section-label">New compute job</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: 20 }}>
            Specify your requirements. The scheduler will automatically select the best compatible GPU.
          </p>

          {jobSuccess && <ComputeJobActions job={jobSuccess} consumer refresh={async () => setJobSuccess((await jobAPI.get(jobSuccess._id)).data)} />}
      <Alert type="error" message={jobError} onClose={() => setJobError("")} />

          <label>Workload<select aria-label="Workload" className="form-input" value={workload} onChange={e=>setWorkload(e.target.value)}>
            <option value="matrix">Verified matrix multiplication</option><option value="script">Python batch script</option>
          </select></label>
          {workload==="script" ? (config ? <ScriptForm cpuEnabled={config.cpuBatchEnabled} created={setJobSuccess}/> : <Spinner text="Loading runtime profiles…" />) : <form onSubmit={handleSubmit} className="job-form">
            <p className="workload-mode">{!config ? "Loading execution configuration..." : config.executionMode === "real_cpu_test" ? "CPU development test (not GPU execution)" : "Real CUDA GPU execution"} - Matrix multiplication</p>
            <div className="form-row">
              <div className="form-group"><label className="form-label" htmlFor="size">Matrix size (2-1024)</label><input className="form-input" id="size" name="size" type="number" min="2" max="1024" value={jobForm.size} onChange={handleChange} required /></div>
              <div className="form-group"><label className="form-label" htmlFor="seed">Seed</label><input className="form-input" id="seed" name="seed" type="number" min="0" max="2147483647" value={jobForm.seed} onChange={handleChange} required /></div>
            </div>
            <div className="form-group"><label className="form-label" htmlFor="reservedMinutes">Reserved minutes (1-10)</label><input className="form-input" id="reservedMinutes" name="reservedMinutes" type="number" min="1" max="10" value={jobForm.reservedMinutes} onChange={handleChange} required /></div>
            <p className="rate-note">{config ? `Reservation rate · ${config.rateWeiPerMinute} wei/min in local test ETH` : "Retrieving reservation rate…"}</p>
            <div className="form-notice">
              <strong>GPU Requirements (optional)</strong>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="requiredGpuMemory">Min GPU Memory (GB)</label>
                <input className="form-input" type="number" id="requiredGpuMemory" name="requiredGpuMemory" value={jobForm.requiredGpuMemory}
                  onChange={handleChange} placeholder="e.g. 16" min="0" disabled={submitting} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="requiredCudaVersion">Min CUDA Version</label>
                <input className="form-input" id="requiredCudaVersion" name="requiredCudaVersion" value={jobForm.requiredCudaVersion}
                  onChange={handleChange} placeholder="e.g. 12.0" disabled={submitting} />
              </div>
            </div>

            <p className="form-hint">Submission fixes the workload. Review the escrow quote before funding.</p>

            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Job →"}
            </button>
          </form>}
        </section>

        {/* ── GPU Marketplace (informational) ── */}
        <section className="dash-section">
          <div className="section-header">
            <h2 className="section-label">Available GPUs</h2>
            <button className="btn btn-ghost btn-sm" onClick={fetchGPUs} disabled={gpusLoading}>Refresh</button>
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.82rem", marginBottom: 16 }}>
            Online workers currently accepting reservations.
          </p>

          {gpusLoading && <Spinner text="Loading GPUs…" />}
          {gpusError  && <Alert type="error" message={gpusError} />}

          {!gpusLoading && !gpusError && gpus.length === 0 && (
            <div className="empty-state" style={{ padding: "30px 0" }}>
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
                  {gpu.executionMode === "real_gpu" && <><span>{gpu.gpuMemory} GB</span><span>CUDA {gpu.cudaVersion}</span></>}
                </div>
                <div className="gpu-price">{gpu.rateWeiPerMinute || config?.rateWeiPerMinute} wei/min (local test ETH)</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

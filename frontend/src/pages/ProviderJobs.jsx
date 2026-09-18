/**
 * pages/ProviderJobs.jsx
 * Provider — view jobs on their GPUs
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { jobAPI } from "../services/api";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

const STATUS_COLORS = {
  CREATED: "#6c63ff", QUEUED: "#f59e0b", ASSIGNED: "#3b82f6",
  RUNNING: "#10b981", RESULT_UPLOADED: "#8b5cf6", COMPLETED: "#00d4aa",
  FAILED: "#ef4444", CANCELLED: "#6b7280",
};

export default function ProviderJobs() {
  const [jobs, setJobs]   = useState([]);
  const [loading, setL]   = useState(true);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    setL(true); setError("");
    try {
      const res = await jobAPI.list();
      setJobs(res.data || []);
    } catch (err) { setError(err.message); }
    finally { setL(false); }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Jobs on My GPUs</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/provider" className="btn btn-ghost btn-sm">← Dashboard</Link>
          <button className="btn btn-ghost btn-sm" onClick={fetchJobs} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      <Alert type="error" message={error} onClose={() => setError("")} />
      {loading && <Spinner text="Loading jobs…" />}

      {!loading && jobs.length === 0 && (
        <div className="empty-state">
          <span>📋</span>
          <p>No jobs submitted for your GPUs yet.</p>
          <p className="empty-hint">Jobs will appear here once consumers submit them.</p>
        </div>
      )}

      {/* Stats strip */}
      {!loading && jobs.length > 0 && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{jobs.length}</div>
            <div className="stat-label">Total Jobs</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "#10b981" }}>{jobs.filter(j => j.status === "RUNNING").length}</div>
            <div className="stat-label">Running</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: "#00d4aa" }}>{jobs.filter(j => j.status === "COMPLETED").length}</div>
            <div className="stat-label">Completed</div>
          </div>
        </div>
      )}

      <div className="jobs-list">
        {jobs.map((job) => (
          <div key={job._id} className="job-card">
            <div className="job-card-header">
              <span className="job-task">{job.taskType || "Job"}</span>
              <span className="job-status-badge" style={{ background: STATUS_COLORS[job.status] + "22", color: STATUS_COLORS[job.status], border: `1px solid ${STATUS_COLORS[job.status]}44` }}>
                {job.status}
              </span>
            </div>
            <div className="job-gpu">🖥️ {job.gpuId?.gpuModel || "GPU"} {job.gpuId?.gpuMemory ? `(${job.gpuId.gpuMemory}GB)` : ""}</div>
            <div className="job-meta">
              <span>Consumer: {job.consumerId?.name || "—"}</span>
              <span>₹{job.price}</span>
              <span>{new Date(job.createdAt).toLocaleDateString()}</span>
            </div>
            {/* Blockchain & Result info */}
            {(job.blockchainTxHash || job.resultHash || job.ipfsCid) && (
              <div className="job-extra-info">
                {job.resultHash && (
                  <span title={job.resultHash}>📦 {job.resultHash.substring(0, 12)}…</span>
                )}
                {job.ipfsCid && (
                  <span title={job.ipfsCid}>🌐 {job.ipfsCid.substring(0, 14)}…</span>
                )}
                {job.blockchainTxHash && (
                  <span title={job.blockchainTxHash}>⛓️ {job.blockchainTxHash.substring(0, 12)}…</span>
                )}
              </div>
            )}
            {job.completedAt && (
              <div className="job-meta" style={{ marginTop: 4 }}>
                <span>Completed: {new Date(job.completedAt).toLocaleString()}</span>
              </div>
            )}
            <div className="job-id">ID: {job._id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

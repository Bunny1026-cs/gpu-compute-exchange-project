/**
 * pages/ProviderJobs.jsx
 * Provider — view jobs on their GPUs
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { jobAPI } from "../services/api";
import ComputeJobActions from "../components/ComputeJobActions";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

import StatusBadge from "../components/StatusBadge";

export default function ProviderJobs() {
  const [jobs, setJobs]   = useState([]);
  const [loading, setL]   = useState(true);
  const [error, setError] = useState("");

  const fetchJobs = useCallback(async () => {
    setError("");
    try {
      const res = await jobAPI.list();
      setJobs(res.data || []);
    } catch (err) { setError(err.message); }
    finally { setL(false); }
  }, []);

  useEffect(() => { fetchJobs(); const timer = setInterval(fetchJobs, 5000); return () => clearInterval(timer); }, [fetchJobs]);

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

      {!loading && !error && jobs.length === 0 && (
        <div className="empty-state">
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
            <div className="stat-value" >{jobs.filter(j => j.status === "RUNNING").length}</div>
            <div className="stat-label">Running</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" >{jobs.filter(j => j.status === "COMPLETED").length}</div>
            <div className="stat-label">Completed</div>
          </div>
        </div>
      )}

      <div className="jobs-list">
        {jobs.map((job) => (
          <div key={job._id} className="job-card">
            <div className="job-card-header">
              <span className="job-task">{job.taskType === "matrix_multiply" ? "Matrix multiplication" : job.taskType || "Job"}</span>
              <StatusBadge status={job.status} />
            </div>
            <div className="job-gpu">{job.gpuId?.gpuModel || "Awaiting assignment"} {job.gpuId?.gpuMemory ? `(${job.gpuId.gpuMemory}GB)` : ""}</div>
            <div className="job-meta">
              <span>Consumer: {job.consumerId?.name || "—"}</span>
              <span>{job.protocol === "real" ? `${job.escrowAmountWei} wei (test ETH)` : `₹${job.price}`}</span>
              <span>{new Date(job.createdAt).toLocaleDateString()}</span>
            </div>
            {/* Blockchain & Result info */}
            {(job.blockchainTxHash || job.resultHash || job.ipfsCid) && (
              <div className="job-extra-info">
                {job.resultHash && (
                  <span title={job.resultHash}>{job.resultHash.substring(0, 12)}…</span>
                )}
                {job.ipfsCid && (
                  <span title={job.ipfsCid}>{job.ipfsCid.substring(0, 14)}…</span>
                )}
                {job.blockchainTxHash && (
                  <span title={job.blockchainTxHash}>{job.blockchainTxHash.substring(0, 12)}…</span>
                )}
              </div>
            )}
            {job.completedAt && (
              <div className="job-meta" style={{ marginTop: 4 }}>
                <span>Completed: {new Date(job.completedAt).toLocaleString()}</span>
              </div>
            )}
            <details className="provider-job-details"><summary>Workload, results and payment</summary>
              <ComputeJobActions job={job} refresh={fetchJobs} />
            </details>
            <div className="job-id">ID: {job._id}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

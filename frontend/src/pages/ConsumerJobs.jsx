/**
 * pages/ConsumerJobs.jsx
 * Consumer — list and view submitted jobs
 */
import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { jobAPI } from "../services/api";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

const STATUS_COLORS = {
  CREATED:         "#6c63ff",
  QUEUED:          "#f59e0b",
  ASSIGNED:        "#3b82f6",
  RUNNING:         "#10b981",
  RESULT_UPLOADED: "#8b5cf6",
  COMPLETED:       "#00d4aa",
  FAILED:          "#ef4444",
  CANCELLED:       "#6b7280",
};

export default function ConsumerJobs() {
  const [jobs, setJobs]   = useState([]);
  const [loading, setL]   = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);

  const fetchJobs = useCallback(async () => {
    setL(true); setError("");
    try {
      const res = await jobAPI.list();
      setJobs(res.data || []);
    } catch (err) { setError(err.message); }
    finally { setL(false); }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const viewJob = async (id) => {
    try {
      const res = await jobAPI.get(id);
      setSelected(res.data);
      setResult(null);
      if (res.data.resultHash || res.data.ipfsCid) {
        const resultResponse = await jobAPI.result(id);
        setResult(resultResponse.data.result);
      }
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">My Jobs</h1>
        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/consumer" className="btn btn-ghost btn-sm">← Dashboard</Link>
          <button className="btn btn-ghost btn-sm" onClick={fetchJobs} disabled={loading}>↻ Refresh</button>
        </div>
      </div>

      <Alert type="error" message={error} onClose={() => setError("")} />
      {loading && <Spinner text="Loading jobs…" />}

      {!loading && jobs.length === 0 && (
        <div className="empty-state">
          <span>📋</span>
          <p>No jobs submitted yet.</p>
          <Link to="/consumer" className="btn btn-primary" style={{ marginTop: 12 }}>Submit Your First Job →</Link>
        </div>
      )}

      <div className="jobs-layout">
        {/* Job list */}
        <div className="jobs-list">
          {jobs.map((job) => (
            <div key={job._id} className={`job-card ${selected?._id === job._id ? "selected" : ""}`}
              onClick={() => viewJob(job._id)}>
              <div className="job-card-header">
                <span className="job-task">{job.taskType || "Job"}</span>
                <span className="job-status-badge" style={{ background: STATUS_COLORS[job.status] + "22", color: STATUS_COLORS[job.status], border: `1px solid ${STATUS_COLORS[job.status]}44` }}>
                  {job.status}
                </span>
              </div>
              <div className="job-gpu">🖥️ {job.gpuId?.gpuModel || "GPU"}</div>
              <div className="job-meta">
                <span>₹{job.price}</span>
                <span>{new Date(job.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="job-id">ID: {job._id}</div>
            </div>
          ))}
        </div>

        {/* Job detail panel */}
        {selected && (
          <div className="job-detail">
            <div className="job-detail-header">
              <h3>Job Detail</h3>
              <button className="btn-clear" onClick={() => { setSelected(null); setResult(null); }}>✕</button>
            </div>
            <div className="detail-row"><span>Status</span>
              <span className="job-status-badge" style={{ background: STATUS_COLORS[selected.status] + "22", color: STATUS_COLORS[selected.status], border: `1px solid ${STATUS_COLORS[selected.status]}44` }}>
                {selected.status}
              </span>
            </div>
            <div className="detail-row"><span>Task Type</span><span>{selected.taskType || "—"}</span></div>
            <div className="detail-row"><span>GPU</span><span>{selected.gpuId?.gpuModel || "Pending"} {selected.gpuId?.gpuMemory ? `(${selected.gpuId.gpuMemory}GB)` : ""}</span></div>
            <div className="detail-row"><span>Price</span><span>₹{selected.price}</span></div>
            <div className="detail-row"><span>Created</span><span>{new Date(selected.createdAt).toLocaleString()}</span></div>
            {selected.completedAt && (
              <div className="detail-row"><span>Completed</span><span>{new Date(selected.completedAt).toLocaleString()}</span></div>
            )}

            {/* Blockchain info */}
            {selected.blockchainTxHash && (
              <div className="detail-section">
                <div className="detail-section-title">⛓️ Blockchain</div>
                <div className="detail-row"><span>Tx Hash</span>
                  <span className="detail-hash" title={selected.blockchainTxHash}>
                    {selected.blockchainTxHash.substring(0, 18)}…
                  </span>
                </div>
                {selected.escrowAmountWei && (
                  <div className="detail-row"><span>Escrow</span>
                    <span>{(Number(selected.escrowAmountWei) / 1e18).toFixed(4)} ETH (demo)</span>
                  </div>
                )}
              </div>
            )}

            {/* Result info */}
            {(selected.resultHash || selected.ipfsCid) && (
              <div className="detail-section">
                <div className="detail-section-title">📦 Result</div>
                {selected.resultHash && (
                  <div className="detail-row"><span>Hash</span>
                    <span className="detail-hash" title={selected.resultHash}>
                      {selected.resultHash.substring(0, 18)}…
                    </span>
                  </div>
                )}
                {selected.ipfsCid && (
                  <div className="detail-row"><span>IPFS CID</span>
                    <span className="detail-hash" title={selected.ipfsCid}>
                      {selected.ipfsCid.substring(0, 20)}…
                    </span>
                  </div>
                )}
                {result !== null && (
                  <pre style={{ margin: "12px 0 0", maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>
                    {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
            )}

            {/* Status-specific notices */}
            {selected.status === "QUEUED" && (
              <div className="form-notice" style={{ marginTop: 12 }}>
                <span>⏳</span>
                <span>Job is queued. The scheduler will assign a GPU automatically.</span>
              </div>
            )}
            {selected.status === "ASSIGNED" && (
              <div className="form-notice" style={{ marginTop: 12 }}>
                <span>🖥️</span>
                <span>GPU assigned. Waiting for the worker to pick up this job.</span>
              </div>
            )}
            {selected.status === "RUNNING" && (
              <div className="form-notice" style={{ marginTop: 12 }}>
                <span>🔄</span>
                <span>Job is currently executing on the GPU.</span>
              </div>
            )}
            {selected.status === "COMPLETED" && (
              <div className="form-notice" style={{ marginTop: 12, borderColor: "#10b981" }}>
                <span>✅</span>
                <span>Job completed successfully. Result verified and payment released.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

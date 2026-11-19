/**
 * pages/ConsumerJobs.jsx
 * Consumer — list and view submitted jobs
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { jobAPI } from "../services/api";
import ComputeJobActions from "../components/ComputeJobActions";
import Alert from "../components/Alert";
import Spinner from "../components/Spinner";

import StatusBadge from "../components/StatusBadge";

export default function ConsumerJobs() {
  const [params] = useSearchParams();
  const requestedJob=params.get("job");
  const [jobs, setJobs]   = useState([]);
  useEffect(()=>{
    if (!requestedJob) return;
    let active=true;
    jobAPI.get(requestedJob).then(r=>{if(active){setSelected(r.data);setResult(null);}}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[requestedJob]);
  const [loading, setL]   = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const detailRef = useRef(null);
  const selectedId = selected?._id;
  useEffect(() => { if (selectedId) detailRef.current?.focus(); }, [selectedId]);

  const fetchJobs = useCallback(async () => {
    setError("");
    try {
      const res = await jobAPI.list();
      setJobs(res.data || []);
      setSelected((old) => old ? res.data.find((job) => job._id === old._id) || old : null);
    } catch (err) { setError(err.message); }
    finally { setL(false); }
  }, []);

  useEffect(() => { fetchJobs(); const timer = setInterval(fetchJobs, 5000); return () => clearInterval(timer); }, [fetchJobs]);

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

      {!loading && !error && jobs.length === 0 && (
        <div className="empty-state">
          <p>No jobs submitted yet.</p>
          <Link to="/consumer" className="btn btn-primary" style={{ marginTop: 12 }}>Submit Your First Job →</Link>
        </div>
      )}

      <div className="jobs-layout">
        {/* Job list */}
        <div className="jobs-list">
          {jobs.map((job) => (
            <button type="button" key={job._id} aria-pressed={selected?._id === job._id} className={`job-card ${selected?._id === job._id ? "selected" : ""}`}
              onClick={() => viewJob(job._id)}>
              <div className="job-card-header">
                <span className="job-task">{job.taskType === "matrix_multiply" ? "Matrix multiplication" : job.taskType || "Job"}</span>
                <StatusBadge status={job.status} />
              </div>
              <div className="job-gpu">{job.gpuId?.gpuModel || "Awaiting assignment"}</div>
              <div className="job-meta">
                <span>{job.status === "DRAFT" ? "Awaiting quote" : job.protocol === "real" ? `${job.escrowAmountWei} wei (test ETH)` : `₹${job.price}`}</span>
                <span>{new Date(job.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="job-id">ID: {job._id}</div>
            </button>
          ))}
        </div>

        {/* Job detail panel */}
        {selected && (
          <section ref={detailRef} tabIndex={-1} className="job-detail" aria-label="Selected job">
            <div className="job-detail-header">
              <h3>Job Detail</h3>
              <button aria-label="Close job detail" className="btn-clear" onClick={() => { setSelected(null); setResult(null); }}>✕</button>
            </div>
            <div className="detail-row"><span>Status</span>
              <StatusBadge status={selected.status} />
            </div>
            <div className="detail-row"><span>Task Type</span><span>{selected.taskType || "—"}</span></div>
            <div className="detail-row"><span>GPU</span><span>{selected.gpuId?.gpuModel || "Pending"} {selected.gpuId?.gpuMemory ? `(${selected.gpuId.gpuMemory}GB)` : ""}</span></div>
            {selected.protocol !== "real" && <div className="detail-row"><span>Price</span><span>₹{selected.price}</span></div>}
            <div className="detail-row"><span>Created</span><span>{new Date(selected.createdAt).toLocaleString()}</span></div>
            {selected.completedAt && (
              <div className="detail-row"><span>Completed</span><span>{new Date(selected.completedAt).toLocaleString()}</span></div>
            )}

            <ComputeJobActions job={selected} consumer refresh={fetchJobs} />
            {/* Blockchain info */}
            {selected.blockchainTxHash && (
              <div className="detail-section">
                <div className="detail-section-title">Blockchain</div>
                <div className="detail-row"><span>Tx Hash</span>
                  <span className="detail-hash" title={selected.blockchainTxHash}>
                    {selected.blockchainTxHash.substring(0, 18)}…
                  </span>
                </div>
                {selected.escrowAmountWei && (
                  <div className="detail-row"><span>Escrow</span>
                    <span>{selected.escrowAmountWei} wei (local test ETH)</span>
                  </div>
                )}
              </div>
            )}

            {/* Result info */}
            {(selected.resultHash || selected.ipfsCid) && (
              <div className="detail-section">
                <div className="detail-section-title">Result</div>
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
                  <details><summary>Result payload</summary><pre className="result-payload">
                    {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
                  </pre></details>
                )}
              </div>
            )}

            {/* Status-specific notices */}
            {selected.status === "QUEUED" && (
              <div className="form-notice" style={{ marginTop: 12 }}>
                <span>Job is queued. The scheduler will assign a GPU automatically.</span>
              </div>
            )}
            {selected.status === "ASSIGNED" && (
              <div className="form-notice" style={{ marginTop: 12 }}>
                <span>GPU assigned. Waiting for the worker to pick up this job.</span>
              </div>
            )}
            {selected.status === "RUNNING" && (
              <div className="form-notice" style={{ marginTop: 12 }}>
                <span>Job is executing in its explicitly labeled computation mode.</span>
              </div>
            )}
            {selected.status === "COMPLETED" && (
              <div className="form-notice" style={{ marginTop: 12, borderColor: "#10b981" }}>
                <span>Job completed successfully. Result verified and payment released.</span>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

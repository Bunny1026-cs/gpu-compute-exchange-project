import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { batchAPI, jobAPI } from "../services/api";
import Alert from "./Alert";

export default function BatchActions({ job, consumer, refresh }) {
  const [error,setError]=useState("");
  const [reason,setReason]=useState("");
  const [busy,setBusy]=useState(false);
  const navigate=useNavigate();
  async function act(fn) {
    setError(""); setBusy(true);
    try { await fn(); await refresh?.(); } catch(err){setError(err.message);} finally{setBusy(false);}
  }
  const button=(text,fn)=><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={()=>act(fn)}>{text}</button>;
  return <section className="detail-section">
    <strong>Python batch · {job.status}</strong>
    <p>{job.spec.profile} · {job.spec.seconds} s limit · {job.spec.minVramGiB} GiB minimum VRAM</p>
    <p>Expected files · {job.spec.outputs.join(", ")}</p>
    <details><summary>Frozen inputs</summary><code>{job.spec.scriptHash}</code><p>Arguments · {JSON.stringify(job.spec.args)}</p><p>{job.spec.image}</p></details>
    {job.escrowAmountWei && <p>Fixed quote · {job.rateWeiPerMinute} wei/min × {job.reservedMinutes} min = {job.escrowAmountWei} wei</p>}
    {job.status==="DRAFT" && <p>Waiting for a compatible device.</p>}
    {job.error && <p role="status">{job.error}</p>}
    {job.liveLog && <pre aria-label="Worker log">{job.liveLog}</pre>}
    {job.resultMetadata && <p>Exit {job.resultMetadata.exitCode ?? "unavailable"} · {job.resultMetadata.elapsedMs?.toFixed(0) ?? "unknown"} ms · {job.resultMetadata.capabilities?.gpuModel || job.gpuId?.gpuModel || job.resultMetadata.device} · {job.resultMetadata.runtime}</p>}
    {job.verification?.files?.map(f=><div key={f.name}>{button("Download "+f.name,()=>batchAPI.download(job._id,f.name))} · {f.bytes} bytes <code>{f.sha256}</code></div>)}
    {job.status==="REVIEW" && <p>File integrity checked. Review by {new Date(job.reviewUntil).toLocaleString()}.</p>}
    {consumer && <div className="gpu-actions">
      {["DRAFT","AWAITING_FUNDING"].includes(job.status) && button("Refresh quote",()=>batchAPI.quote(job._id))}
      {job.status==="AWAITING_FUNDING" && button("Fund with Demo Wallet",()=>jobAPI.fund(job._id))}
      {["DRAFT","AWAITING_FUNDING","QUEUED"].includes(job.status) && button("Cancel job",()=>jobAPI.cancel(job._id))}
      {job.status==="REVIEW" && <>{button("Accept and pay",()=>batchAPI.review(job._id,"accept"))}
        <label>Issue description<input className="form-input" value={reason} onChange={e=>setReason(e.target.value)}/></label>
        {button("Report issue",()=>batchAPI.review(job._id,"issue",reason))}</>}
      {button("Run again",async()=>{const r=await batchAPI.repeat(job._id);navigate("/consumer/jobs?job="+r.data._id);})}
    </div>}
    {job.paymentWei && <p>Payment released · {job.paymentWei} wei</p>}
    {job.receipts?.length>0 && <details><summary>Escrow receipts ({job.receipts.length})</summary>{job.receipts.map(r=><div className="receipt" key={r.txHash}><strong>{r.action}</strong><code>{r.txHash}</code>Gas {r.gasUsed}</div>)}</details>}
    <Alert message={error}/>
  </section>;
}

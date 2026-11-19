import { useState } from "react";
import ExecutionTimes from "./ExecutionTimes";
import BatchActions from "./BatchActions";
import { jobAPI } from "../services/api";

export default function ComputeJobActions({ job, consumer = false, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function act(action) {
    setBusy(true); setError("");
    try { await jobAPI[action](job._id); await refresh?.(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (job.taskType === "python_batch") return <BatchActions job={job} consumer={consumer} refresh={refresh}/>;
  if (job.protocol !== "real") return <p>Historical prototype job; not evidence of real computation.</p>;
  return <section className="detail-section" onClick={(event) => event.stopPropagation()}>
    <p><strong>{job.spec?.executionMode === "real_cpu_test" ? "CPU development test — not GPU evidence" : "CUDA GPU workload"}</strong></p>
    <p>{job.spec?.size} × {job.spec?.size}, float32 · Seed {job.spec?.seed}</p>
    <p>Job status · {job.status}</p>
    <p className="escrow-line">Local test ETH: {job.rateWeiPerMinute} wei/min × {job.reservedMinutes} min = {job.escrowAmountWei} wei</p>
    {job.paymentWei && <p className="paid-line">Payment released: {job.paymentWei} wei (confirmed event)</p>}
    {job.resultHash && <div style={{ overflowWrap: "anywhere" }}>
      <p>Artifact storage · {job.ipfsCid ? "Kubo IPFS and local file" : "Local file"}</p>
      <p>SHA-256 · {job.resultHash}</p>
      {job.verification?.verified && <p>CPU reference verified · maximum absolute error {job.verification.maxAbsoluteError}</p>}
      {job.verification?.preview && <details>
        <summary>Verified matrix preview (top left)</summary>
        <table><tbody>{job.verification.preview.map((row, i) => <tr key={i}>
          {row.map((value, j) => <td key={j}>{value.toPrecision(6)}</td>)}
        </tr>)}</tbody></table>
      </details>}
    </div>}
    {job.error && <p role="status" style={{ color: "var(--danger)" }}>{job.error}</p>}
    {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {consumer && job.status === "AWAITING_FUNDING" && <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => act("fund")}>Fund with Demo Wallet</button>}
      {consumer && !["COMPLETED", "REFUNDED", "CANCELLED", "FAILED"].includes(job.status) && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => act("cancel")}>Cancel / refund</button>}
      {["RESULT_UPLOADED", "SETTLEMENT_PENDING", "REFUND_PENDING"].includes(job.status) && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => act("reconcile")}>Retry settlement / refund</button>}
      {job.resultHash && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => act("artifact")}>Download result .npy</button>}
    </div>
    {job.resultMetadata && <details><summary>Actual execution measurements</summary><ExecutionTimes timings={job.resultMetadata.timingsMs} /><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(job.resultMetadata, null, 2)}</pre></details>}
    {job.receipts?.length > 0 && <details><summary>Confirmed local-chain receipts ({job.receipts.length})</summary>
      {job.receipts.map((receipt) => <div key={receipt.txHash} className="receipt">
        <strong>{receipt.action}</strong><code>{receipt.txHash}</code><span>Gas: {receipt.gasUsed} · Block: {receipt.blockNumber}</span>
        {receipt.amountWei && <span> · {receipt.amountWei} wei</span>}
        {Number.isFinite(receipt.confirmationMs) && <span> · Receipt observed in {receipt.confirmationMs.toFixed(1)} ms</span>}
      </div>)}
    </details>}
  </section>;
}

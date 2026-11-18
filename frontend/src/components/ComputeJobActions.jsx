import { useState } from "react";
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
  if (job.protocol !== "real") return <p>Historical prototype job; not evidence of real computation.</p>;
  return <section className="detail-section" onClick={(event) => event.stopPropagation()}>
    <p><strong>{job.spec?.executionMode === "real_cpu_test" ? "CPU development test — not GPU evidence" : "CUDA GPU workload"}</strong></p>
    <p>{job.spec?.size} × {job.spec?.size}, float32 · Seed {job.spec?.seed}</p>
    <p>Local test ETH: {job.rateWeiPerMinute} wei/min × {job.reservedMinutes} min = {job.escrowAmountWei} wei</p>
    {job.paymentWei && <p>Payment released: {job.paymentWei} wei (confirmed event)</p>}
    {job.error && <p role="status" style={{ color: "var(--danger)" }}>{job.error}</p>}
    {error && <p role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {consumer && job.status === "AWAITING_FUNDING" && <button disabled={busy} className="btn btn-primary btn-sm" onClick={() => act("fund")}>Fund with Demo Wallet</button>}
      {consumer && !["COMPLETED", "REFUNDED", "CANCELLED", "FAILED"].includes(job.status) && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => act("cancel")}>Cancel / refund</button>}
      {["RESULT_UPLOADED", "SETTLEMENT_PENDING", "REFUND_PENDING"].includes(job.status) && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => act("reconcile")}>Retry settlement / refund</button>}
      {job.resultHash && <button disabled={busy} className="btn btn-ghost btn-sm" onClick={() => act("artifact")}>Download result .npy</button>}
    </div>
    {job.resultMetadata && <details><summary>Actual execution measurements</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(job.resultMetadata, null, 2)}</pre></details>}
    {job.receipts?.length > 0 && <details><summary>Confirmed local-chain receipts ({job.receipts.length})</summary>
      {job.receipts.map((receipt) => <div key={receipt.txHash} style={{ overflowWrap: "anywhere", marginTop: 12 }}>
        <strong>{receipt.action}</strong><br />{receipt.txHash}<br />Gas: {receipt.gasUsed} · Block: {receipt.blockNumber}
        {receipt.amountWei && <span> · {receipt.amountWei} wei</span>}
      </div>)}
    </details>}
  </section>;
}

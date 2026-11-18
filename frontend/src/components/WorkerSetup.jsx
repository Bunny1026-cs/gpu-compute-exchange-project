import { useState } from "react";
import { gpuAPI } from "../services/api";
export default function WorkerSetup({ gpu, refresh }) {
  const [wallet, setWallet] = useState(gpu.providerWallet || "");
  const [credential, setCredential] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function provision() {
    setBusy(true); setError("");
    try { const result = await gpuAPI.workerKey(gpu._id, wallet); setCredential(result.data); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div>
    <p>{gpu.online ? "Worker online" : "Worker offline / awaiting setup"} · {gpu.executionMode || "Not detected"}</p>
    {gpu.lastHeartbeat && <p>Last heartbeat: {new Date(gpu.lastHeartbeat).toLocaleString()}</p>}
    <label className="form-label">Provider development wallet address</label>
    <input className="form-input" value={wallet} onChange={(event) => setWallet(event.target.value)} placeholder="0x…" />
    <button className="btn btn-ghost btn-sm" disabled={busy || gpu.status === "BUSY"} onClick={provision}>Create / rotate worker credential</button>
    {error && <p role="alert">{error}</p>}
    {credential && <div><p>Save this key in Laptop 2's ignored worker/.env. It is shown only now; rotation revokes the old key.</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>WORKER_API_KEY={credential.workerApiKey}</pre>
      <button className="btn btn-ghost btn-xs" onClick={() => setCredential(null)}>Hide credential</button></div>}
  </div>;
}

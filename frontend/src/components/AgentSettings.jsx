import { useState } from "react";
import { batchAPI } from "../services/api";
import Alert from "./Alert";

export function PairAgent() {
  const [pair,setPair]=useState(null);
  const [error,setError]=useState("");
  return <section className="detail-section"><div>
    <button className="btn btn-primary" onClick={async()=>{try{setPair((await batchAPI.pairCode()).data);setError("");}catch(err){setError(err.message);}}}>Pair local agent</button></div>
    {pair && <div><p>Single-use code expires at {new Date(pair.expires).toLocaleTimeString()}</p><code>{pair.code}</code></div>}
    <Alert message={error}/></section>;
}
export function DeviceSettings({gpu,refresh}) {
  const [rate,setRate]=useState(gpu.rateWeiPerMinute);
  const [error,setError]=useState("");
  async function save(enabled) {
    try{await batchAPI.share(gpu._id,rate,enabled);setError("");await refresh();}catch(err){setError(err.message);}
  }
  return <section className="worker-settings"><p>{gpu.online?"Agent online":"Agent offline"} · {gpu.capabilities?.runtime || "Runtime untested"}</p>
    {gpu.capabilities?.driver && <p>Driver {gpu.capabilities.driver} · {gpu.gpuMemory} GiB</p>}
    <p>{gpu.capabilities?.testedImage ? (gpu.executionMode==="real_gpu"?"CUDA operation verified":"CPU runtime verified") : gpu.capabilities?.probeError || "Runtime unavailable"}</p>
    <label>Rate in wei/min<input className="form-input" value={rate} onChange={e=>setRate(e.target.value)}/></label>
    <div className="gpu-actions"><button className="btn btn-ghost" onClick={()=>save(gpu.availability)}>Save rate</button>
    <button className="btn btn-primary" onClick={()=>save(!gpu.availability)}>{gpu.availability?"Stop accepting jobs":"Enable device"}</button></div>
    <Alert message={error}/></section>;
}

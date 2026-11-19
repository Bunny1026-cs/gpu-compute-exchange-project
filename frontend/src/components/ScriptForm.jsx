import { useState } from "react";
import { batchAPI } from "../services/api";
import Alert from "./Alert";
import training from "../assets/train.py?raw";

export default function ScriptForm({ created, cpuEnabled }) {
  const [source, setSource] = useState("");
  const [args, setArgs] = useState("[]");
  const [outputs, setOutputs] = useState("result.txt");
  const [profile, setProfile] = useState(cpuEnabled ? "python-cpu" : "pytorch-cuda");
  const [seconds, setSeconds] = useState(30);
  const [vram, setVram] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await batchAPI.create({source, args:JSON.parse(args), profile,
        outputs:outputs.split(",").map(s=>s.trim()), seconds:Number(seconds), minVramGiB:profile==="python-cpu"?0:Number(vram)});
      created(result.data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <form className="job-form" onSubmit={submit}>
    <Alert message={error} />
    <label>Runtime<select className="form-input" value={profile} onChange={e=>setProfile(e.target.value)}>
      {cpuEnabled && <option value="python-cpu">Python 3.12.10 · CPU development</option>}<option value="pytorch-cuda">PyTorch 2.5.1 · CUDA 12.4</option>
    </select></label>
    {profile==="pytorch-cuda" && <button type="button" className="btn btn-ghost" onClick={()=>{setSource(training);setOutputs("metrics.json, checkpoint.pt");setSeconds(90);}}>Load training template</button>}
    <label>Upload Python file<input className="form-input" type="file" accept=".py" onChange={async e=>{
      const file=e.target.files?.[0]; if(!file)return;
      try { if (!file.name.endsWith(".py") || file.size>49152) throw new Error("Choose a .py file up to 48 KiB");
        setSource(await file.text()); setError(""); } catch(err){setError(err.message);}
    }} /></label>
    <label>Python source<textarea className="form-input" rows="8" value={source} required onChange={e=>setSource(e.target.value)} /></label>
    <label>Arguments (JSON array)<input className="form-input" value={args} onChange={e=>setArgs(e.target.value)} /></label>
    <label>Time limit in seconds<input className="form-input" type="number" min="1" max="600" required value={seconds} onChange={e=>setSeconds(e.target.value)} /></label>
    {profile==="pytorch-cuda" && <label>Minimum VRAM in GiB<input className="form-input" type="number" min="0" step="0.1" value={vram} onChange={e=>setVram(e.target.value)} /></label>}
    <label>Expected output filenames (comma-separated)<input className="form-input" required value={outputs} onChange={e=>setOutputs(e.target.value)} /></label>
    <p className="form-hint">Use trusted scripts. Write declared files in the working directory. A draft is saved when no compatible device is available.</p>
    <button disabled={busy} className="btn btn-primary">Save and quote</button>
  </form>;
}

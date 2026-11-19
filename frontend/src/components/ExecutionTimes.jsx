const stages = [["hostToDevice", "Input transfer"], ["kernel", "Matrix multiplication"], ["deviceToHost", "Output transfer"]];

export default function ExecutionTimes({ timings }) {
  const measured = stages.filter(([key]) => Number.isFinite(timings?.[key]) && timings[key] >= 0);
  if (!measured.length) return null;
  const maximum = Math.max(...measured.map(([key]) => timings[key]));
  return <figure className="execution-times">
    <figcaption>Measured execution stages</figcaption>
    {measured.map(([key, label]) => <div key={key} className="time-row">
      <span>{label}</span><span className="time-track" aria-hidden="true">
        <i style={{ width: (maximum ? timings[key] / maximum * 100 : 0) + "%" }} /></span>
      <span>{timings[key].toLocaleString(undefined, { maximumSignificantDigits: 4 })} ms</span>
    </div>)}
  </figure>;
}

/**
 * components/Spinner.jsx
 * Simple loading indicator
 */
export default function Spinner({ size = 24, text = "" }) {
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: "0.9rem" }}>
      <div className="spinner" style={{ width: size, height: size }} />
      {text && <span>{text}</span>}
    </div>
  );
}

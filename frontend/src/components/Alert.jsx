/**
 * components/Alert.jsx
 * Reusable success/error message component
 */
export default function Alert({ type = "error", message, onClose }) {
  if (!message) return null;
  const colors = {
    error:   { bg: "rgba(255,77,109,0.12)", border: "rgba(255,77,109,0.4)", icon: "❌" },
    success: { bg: "rgba(0,212,170,0.12)",  border: "rgba(0,212,170,0.4)",  icon: "✅" },
    info:    { bg: "rgba(108,99,255,0.12)", border: "rgba(108,99,255,0.4)", icon: "ℹ️" },
  };
  const c = colors[type] || colors.info;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 16, display: "flex", alignItems: "flex-start", gap: 10, fontSize: "0.9rem" }}>
      <span>{c.icon}</span>
      <span style={{ flex: 1 }}>{message}</span>
      {onClose && <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "1rem" }}>✕</button>}
    </div>
  );
}

const tones = {
  COMPLETED: "positive", RUNNING: "positive", FAILED: "negative",
  QUEUED: "pending", AWAITING_FUNDING: "pending", REFUND_PENDING: "pending",
  SETTLEMENT_PENDING: "pending", ASSIGNED: "active", RESULT_UPLOADED: "active",
};
export default function StatusBadge({ status }) {
  return <span className={"status-badge " + (tones[status] || "neutral")}>{status?.replaceAll("_", " ").toLowerCase()}</span>;
}

export type BridgeStage = "preparing" | "approval-required" | "awaiting-signature" | "source-submitted" | "source-final" | "message-pending" | "destination-pending" | "completed" | "failed";
const order: BridgeStage[] = ["preparing", "approval-required", "awaiting-signature", "source-submitted", "source-final", "message-pending", "destination-pending", "completed"];
export function canAdvanceBridge(from: BridgeStage, to: BridgeStage): boolean {
  if (to === "failed") return from !== "completed" && from !== "failed";
  return order.indexOf(to) === order.indexOf(from) + 1;
}

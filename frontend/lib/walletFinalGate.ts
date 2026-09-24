import { arcFeeMateriallyChanged } from "./arcFees.ts";
import { calculateCctpForwardingAmounts, type CctpForwardingFee, type CctpTransferAmounts } from "./cctp.ts";

/** Provider calls are injected by the wallet handler; unavailable evidence fails closed. */
export async function refreshReviewedSendFee(reviewed: { status: string; rawFee?: bigint }, load: () => Promise<bigint | undefined>): Promise<bigint | undefined> {
  if (reviewed.status !== "ready" || reviewed.rawFee === undefined) return undefined;
  try {
    const current = await load();
    return current !== undefined && !arcFeeMateriallyChanged(reviewed.rawFee, current) ? current : undefined;
  } catch { return undefined; }
}

export async function refreshReviewedCctpBurnFee(reviewed: CctpTransferAmounts, load: () => Promise<CctpForwardingFee>, now: number, maxAgeMs: number): Promise<boolean> {
  try {
    const fee = await load();
    if (!Number.isFinite(fee.quotedAt) || fee.quotedAt > now || now - fee.quotedAt > maxAgeMs) return false;
    const current = calculateCctpForwardingAmounts(reviewed.transferAmount, fee);
    return current.totalAmount === reviewed.totalAmount && current.maxFee === reviewed.maxFee && current.protocolFee === reviewed.protocolFee && current.forwardingFee === reviewed.forwardingFee;
  } catch { return false; }
}

import type { Hash, TransactionReceipt } from "viem";

export type ArcTransactionStage =
  | "preparing"
  | "awaiting-signature"
  | "submitted"
  | "pending"
  | "final-success"
  | "final-reverted"
  | "dropped"
  | "rpc-error";

export type ArcTransactionState = {
  stage: ArcTransactionStage;
  hash?: Hash;
  receipt?: TransactionReceipt;
  error?: string;
  retrySafe: boolean;
};

export type ReceiptLookup = (hash: Hash) => Promise<TransactionReceipt | null>;

export const initialArcTransactionState = (): ArcTransactionState => ({ stage: "preparing", retrySafe: true });

export function transitionArcTransaction(
  state: ArcTransactionState,
  event:
    | { type: "signature-requested" }
    | { type: "submitted"; hash: Hash }
    | { type: "pending" }
    | { type: "receipt"; receipt: TransactionReceipt }
    | { type: "dropped" }
    | { type: "rpc-error"; error: string },
): ArcTransactionState {
  if (event.type === "signature-requested") return { stage: "awaiting-signature", retrySafe: true };
  if (event.type === "submitted") return { stage: "submitted", hash: event.hash, retrySafe: false };
  if (event.type === "pending") return { ...state, stage: "pending", retrySafe: false };
  if (event.type === "receipt") return {
    ...state,
    stage: event.receipt.status === "success" ? "final-success" : "final-reverted",
    receipt: event.receipt,
    retrySafe: event.receipt.status !== "success",
  };
  if (event.type === "dropped") return { ...state, stage: "dropped", retrySafe: true };
  return { ...state, stage: "rpc-error", error: event.error, retrySafe: false };
}

export async function pollArcTransaction(input: {
  hash: Hash;
  getReceipt: ReceiptLookup;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<ArcTransactionState> {
  const timeoutMs = input.timeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 1_500;
  const now = input.now ?? Date.now;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  let state: ArcTransactionState = { stage: "pending", hash: input.hash, retrySafe: false };

  while (now() - startedAt < timeoutMs) {
    try {
      const receipt = await input.getReceipt(input.hash);
      if (receipt) return transitionArcTransaction(state, { type: "receipt", receipt });
    } catch (error) {
      return transitionArcTransaction(state, { type: "rpc-error", error: error instanceof Error ? error.message : "Arc RPC request failed" });
    }
    await wait(pollIntervalMs);
    state = transitionArcTransaction(state, { type: "pending" });
  }
  return transitionArcTransaction(state, { type: "dropped" });
}

export function arcTransactionGuidance(state: ArcTransactionState): string {
  if (state.stage === "final-success") return "Final on Arc — the transaction succeeded.";
  if (state.stage === "final-reverted") return "Final on Arc — the transaction reverted. Review the error before retrying.";
  if (state.stage === "dropped") return "Not found before the tracking timeout. Check your wallet and ArcScan before retrying.";
  if (state.stage === "rpc-error") return "Arc status is temporarily unavailable. Do not resubmit until you verify the transaction hash.";
  return "Keep this window open while Arc finalizes the transaction.";
}

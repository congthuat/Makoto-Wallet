import type { Hash } from "viem";
import type { TransactionIntent } from "./transactionSafety.ts";
import type { TransactionRequestInput } from "./transactionOrchestrator.ts";

export type CctpGasEnvelope = Readonly<{
  gasLimit: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
  rawMaximumFee: bigint;
}>;

export type SourceReceiptOutcome =
  | { state: "source-confirmed"; hash: Hash; blockNumber: bigint }
  | { state: "source-failed"; hash: Hash; blockNumber?: bigint }
  | { state: "source-confirmation-unknown"; hash: Hash };

export type DestinationVerificationOutcome =
  | "destination-verification-pending"
  | "destination-failed"
  | "destination-confirmed";

export function createCctpGasEnvelope(gasLimit: bigint, maxFeePerGas: bigint, maxPriorityFeePerGas?: bigint): CctpGasEnvelope {
  if (gasLimit <= 0n) throw new Error("A real gas limit is required for CCTP review.");
  if (maxFeePerGas <= 0n) throw new Error("A real EIP-1559 max fee is required for CCTP review.");
  if (maxPriorityFeePerGas !== undefined && (maxPriorityFeePerGas < 0n || maxPriorityFeePerGas > maxFeePerGas)) throw new Error("Invalid EIP-1559 priority fee.");
  return Object.freeze({ gasLimit, maxFeePerGas, ...(maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas }), rawMaximumFee: gasLimit * maxFeePerGas });
}

export function cctpReviewedRequest(intent: Pick<TransactionIntent, "target" | "calldata" | "value" | "chainId">, envelope: CctpGasEnvelope): TransactionRequestInput {
  return {
    to: intent.target,
    data: intent.calldata,
    value: intent.value,
    chainId: intent.chainId,
    gas: envelope.gasLimit,
    maxFeePerGas: envelope.maxFeePerGas,
    ...(envelope.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: envelope.maxPriorityFeePerGas }),
  };
}

export function classifySourceReceipt(hash: Hash, receipt?: { status: "success" | "reverted"; blockNumber?: bigint }): SourceReceiptOutcome {
  if (!receipt) return { state: "source-confirmation-unknown", hash };
  if (receipt.status === "reverted") return { state: "source-failed", hash, ...(receipt.blockNumber === undefined ? {} : { blockNumber: receipt.blockNumber }) };
  if (receipt.blockNumber === undefined) return { state: "source-confirmation-unknown", hash };
  return { state: "source-confirmed", hash, blockNumber: receipt.blockNumber };
}

export function classifyDestinationVerification(input: { hashKnown: boolean; receipt?: "success" | "reverted"; chainMatches?: boolean; recipientEvidence?: boolean; balanceRead?: boolean }): DestinationVerificationOutcome {
  if (!input.hashKnown || input.receipt === undefined) return "destination-verification-pending";
  if (input.receipt === "reverted") return "destination-failed";
  return input.chainMatches && input.recipientEvidence && input.balanceRead ? "destination-confirmed" : "destination-verification-pending";
}

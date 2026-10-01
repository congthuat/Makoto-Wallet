import { decodeEventLog, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, isAddress, keccak256, parseAbiParameters, size, stringToHex, type Address, type Hex } from "viem";
import { arcTestnet } from "viem/chains";
import { erc20BalanceAbi } from "./abi/erc20.ts";

export const ARC_MEMO_ADDRESS = getAddress("0x5294E9927c3306DcBaDb03fe70b92e01cCede505");
export const ARC_MEMO_DOMAIN = "makoto-wallet:memo:v1";

export const arcMemoAbi = [
  { type: "function", name: "memo", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "data", type: "bytes" }, { name: "memoId", type: "bytes32" }, { name: "memoData", type: "bytes" }], outputs: [] },
  { type: "event", name: "Memo", inputs: [{ name: "sender", type: "address", indexed: true }, { name: "target", type: "address", indexed: true }, { name: "callDataHash", type: "bytes32", indexed: false }, { name: "memoId", type: "bytes32", indexed: true }, { name: "memo", type: "bytes", indexed: false }, { name: "memoIndex", type: "uint256", indexed: false }] },
] as const;

export type ArcMemoTransfer = {
  address: typeof ARC_MEMO_ADDRESS;
  abi: typeof arcMemoAbi;
  functionName: "memo";
  args: readonly [Address, Hex, Hex, Hex];
  innerTransferData: Hex;
  memoBytes: Hex;
  memoId: Hex;
  callDataHash: Hex;
  note: string;
};

export function normalizeMemoNote(value: string): string | undefined {
  const note = value.trim();
  if (!note) return undefined;
  if (Array.from(note).length > 100) throw new Error("Memo note exceeds 100 characters");
  const bytes = stringToHex(note);
  if (size(bytes) > 256) throw new Error("Memo note exceeds 256 UTF-8 bytes");
  return note;
}

export function buildArcMemoTransfer({ sender, token, recipient, amount, note, chainId = arcTestnet.id }: { sender: Address | string; token: Address | string; recipient: Address | string; amount: bigint; note: string; chainId?: number }): ArcMemoTransfer {
  if (chainId !== arcTestnet.id) throw new Error("Arc Testnet chain ID is required");
  if (!isAddress(sender) || !isAddress(token) || !isAddress(recipient)) throw new Error("Invalid memo transfer address");
  if (amount <= 0n) throw new Error("Memo transfer amount must be positive");
  const normalized = normalizeMemoNote(note);
  if (!normalized) throw new Error("Memo note is required");
  const normalizedSender = getAddress(sender), normalizedToken = getAddress(token), normalizedRecipient = getAddress(recipient);
  const innerTransferData = encodeFunctionData({ abi: erc20BalanceAbi, functionName: "transfer", args: [normalizedRecipient, amount] });
  const memoBytes = stringToHex(normalized);
  const callDataHash = keccak256(innerTransferData);
  const memoId = keccak256(encodeAbiParameters(parseAbiParameters("string domain, uint256 chainId, address sender, address token, address recipient, uint256 amount, bytes32 callDataHash, bytes32 memoHash"), [ARC_MEMO_DOMAIN, BigInt(chainId), normalizedSender, normalizedToken, normalizedRecipient, amount, callDataHash, keccak256(memoBytes)]));
  return { address: ARC_MEMO_ADDRESS, abi: arcMemoAbi, functionName: "memo", args: [normalizedToken, innerTransferData, memoId, memoBytes], innerTransferData, memoBytes, memoId, callDataHash, note: normalized };
}

export function buildSendTransaction(input: { sender: Address | string; token: Address | string; recipient: Address | string; amount: bigint; note: string; chainId?: number }) {
  const normalized = normalizeMemoNote(input.note);
  if (!isAddress(input.token) || !isAddress(input.recipient)) throw new Error("Invalid send address");
  if (!normalized) return { address: getAddress(input.token), abi: erc20BalanceAbi, functionName: "transfer" as const, args: [getAddress(input.recipient), input.amount] as const };
  return buildArcMemoTransfer({ ...input, note: normalized });
}

export function verifyMemoEvent(logs: readonly { address: Address | string; data: Hex; topics: readonly Hex[] }[], expected: Pick<ArcMemoTransfer, "memoBytes" | "memoId" | "callDataHash"> & { sender: Address | string; target: Address | string }) {
  for (const log of logs) {
    if (!isAddress(log.address) || getAddress(log.address) !== ARC_MEMO_ADDRESS) continue;
    try {
      const decoded = decodeEventLog({ abi: arcMemoAbi, eventName: "Memo", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const args = decoded.args;
      if (getAddress(args.sender) === getAddress(expected.sender) && getAddress(args.target) === getAddress(expected.target) && args.callDataHash === expected.callDataHash && args.memoId === expected.memoId && args.memo === expected.memoBytes) return true;
    } catch { /* Ignore unrelated or malformed Memo-address logs. */ }
  }
  return false;
}

export function decodeInnerTransfer(data: Hex) { return decodeFunctionData({ abi: erc20BalanceAbi, data }); }

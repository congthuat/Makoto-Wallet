import { getAddress, pad, type Address, type Hex } from "viem";

export const ARC_CCTP_DOMAIN = 26;
export const BASE_SEPOLIA_CCTP_DOMAIN = 6;
export const CCTP_STANDARD_FINALITY = 2000;
export const CCTP_TOKEN_MESSENGER_V2 = getAddress("0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA");
export const CCTP_TOKEN_MINTER_V2 = getAddress("0xb43db544E2c27092c107639Ad201b3dEfAbcF192");
export const CCTP_FORWARDING_HOOK_DATA = "0x636374702d666f72776172640000000000000000000000000000000000000000" as Hex;
export const BASE_SEPOLIA_EXPLORER_URL = "https://sepolia.basescan.org";

export type CctpForwardingFee = {
  finalityThreshold: typeof CCTP_STANDARD_FINALITY;
  minimumFee: number;
  forwardFeeMed: string;
  quotedAt: number;
};

export type CctpTransferAmounts = {
  transferAmount: bigint;
  protocolFee: bigint;
  forwardingFee: bigint;
  maxFee: bigint;
  totalAmount: bigint;
};

export const CCTP_TOKEN_MESSENGER_ABI = [
  {
    type: "function",
    name: "depositForBurnWithHook",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "maxFee", type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32" },
      { name: "hookData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export function addressToBytes32(address: Address) {
  return pad(getAddress(address), { size: 32 });
}

export function calculateCctpForwardingAmounts(transferAmount: bigint, fee: CctpForwardingFee): CctpTransferAmounts {
  if (transferAmount <= 0n) throw new Error("Transfer amount must be positive");
  if (fee.finalityThreshold !== CCTP_STANDARD_FINALITY) throw new Error("Only standard finality is supported");
  if (!Number.isFinite(fee.minimumFee) || fee.minimumFee < 0) throw new Error("Invalid CCTP protocol fee");
  if (!/^\d+$/.test(fee.forwardFeeMed)) throw new Error("Invalid forwarding fee");

  const feeBpsHundredths = BigInt(Math.round(fee.minimumFee * 100));
  const protocolFee = (transferAmount * feeBpsHundredths) / 1_000_000n;
  const forwardingFee = BigInt(fee.forwardFeeMed);
  const maxFee = protocolFee + forwardingFee;

  return {
    transferAmount,
    protocolFee,
    forwardingFee,
    maxFee,
    totalAmount: transferAmount + maxFee,
  };
}

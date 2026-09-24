import type { PublicClient } from "viem";
import { arcTestnet } from "viem/chains";
import { getAssetById } from "../assets.ts";
import type { CctpForwardingFee } from "../cctp.ts";
import { xyloRouterAbi, XYLO_ROUTER } from "../swap.ts";
import { createAgentPlanningServices } from "./planning.ts";
import type { QuoteServices } from "./quoteTools.ts";
import { createReadServices } from "./readTools.ts";

/** Adapts viem's generic client signature to the existing Phase 8B read adapter. */
export function createAgentReadServices(client: PublicClient) {
  return createReadServices({
    chain: client.chain!,
    readContract: (args) => args.functionName === "balanceOf"
      ? client.readContract({ address: args.address, abi: args.abi, functionName: "balanceOf", args: [args.args[0]] })
      : client.readContract({ address: args.address, abi: args.abi, functionName: "allowance", args: [args.args[0], args.args[1]] }),
    getTransactionReceipt: ({ hash }) => client.getTransactionReceipt({ hash }),
  });
}

/** Connects the existing read-only quote sources to canonical 8C tools. */
export function createQuoteServices(client: PublicClient): QuoteServices {
  if (client.chain?.id !== arcTestnet.id) throw new Error("Arc Testnet quote client required.");
  const sendEstimator = createAgentPlanningServices(client)!.estimateSendMaximumFee;
  return Object.freeze({
    estimateSendMaximumFee: sendEstimator,
    readXyloOutput: async ({ inputAsset, outputAsset, amount }) => ({
      amountOut: await client.readContract({ address: XYLO_ROUTER, abi: xyloRouterAbi, functionName: "getAmountOut", args: [getAssetById(inputAsset)!.address, getAssetById(outputAsset)!.address, amount] }),
      quotedAt: Date.now(),
    }),
    readDirectCctpFee: async (): Promise<CctpForwardingFee | undefined> => {
      const response = await fetch("/api/cctp-fees", { cache: "no-store" });
      if (!response.ok) return undefined;
      return await response.json() as CctpForwardingFee;
    },
  });
}

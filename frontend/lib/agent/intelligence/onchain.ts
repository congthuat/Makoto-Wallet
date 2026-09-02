import { erc20Abi, formatUnits, getAddress, type Address, type PublicClient } from "viem";
import { arcTestnet } from "viem/chains";
import { SUPPORTED_ASSETS, getAssetByAddress } from "../../assets.ts";
import { ARC_EXPLORER_URL } from "../../config.ts";
import type { WalletActivity } from "../../wallet.ts";
import type { AgentIntelligenceFact, AgentIntelligenceResult, AgentResearchSource, OnchainIntelligenceInput } from "./types.ts";
import type { AgentActivityLoadState } from "../types.ts";

export type OnchainIntelligenceServices = Readonly<{ inspect(input: OnchainIntelligenceInput, activity: readonly WalletActivity[], activityLoadState: AgentActivityLoadState, now: number, activityOwner?: Address): Promise<AgentIntelligenceResult> }>;

export function createOnchainIntelligenceServices(client?: PublicClient): OnchainIntelligenceServices | undefined {
  if (!client) return undefined;
  return Object.freeze({ inspect: (input, activity, loadState, now, owner) => inspectOnchain(client, input, activity, loadState, now, owner) });
}

export async function inspectOnchain(client: Pick<PublicClient, "getCode" | "readContract">, input: OnchainIntelligenceInput, activity: readonly WalletActivity[], activityLoadState: AgentActivityLoadState, now: number, activityOwner: Address = input.address): Promise<AgentIntelligenceResult> {
  const target = getAddress(input.tokenAddress ?? input.address);
  const source: AgentResearchSource = { id: "arc-onchain", title: "Arc Testnet onchain data", publisher: "Arc Testnet", sourceType: "ONCHAIN_VERIFIED", canonicalUrl: `${ARC_EXPLORER_URL}/address/${target}`, fetchedAt: now };
  const facts: AgentIntelligenceFact[] = [{ label: "chain", value: `Arc Testnet (${arcTestnet.id})`, sourceIds: [source.id] }, { label: "address", value: target, sourceIds: [source.id] }];
  const limitations: string[] = [];
  if (input.operation === "activity") {
    if (activityOwner.toLowerCase() !== target.toLowerCase()) return result("activity", facts, source, now, "UNAVAILABLE", ["ACTIVITY_NOT_LOADED_FOR_ADDRESS"]);
    const related = activity;
    const incoming = related.filter((item) => item.direction === "receive").length, outgoing = related.filter((item) => item.direction === "send").length;
    facts.push({ label: "activity", value: `${incoming}:${outgoing}:${related.length}`, sourceIds: [source.id] });
    const counterparties = [...new Set(related.map((item) => item.counterparty))].slice(0, 5);
    if (counterparties.length) facts.push({ label: "counterparties", value: counterparties.join(","), sourceIds: [source.id] });
    if (activityLoadState === "unavailable") limitations.push("ACTIVITY_UNAVAILABLE");
    else if (activityLoadState === "loading") limitations.push("ACTIVITY_LOADING");
    else if (activityLoadState === "partial") limitations.push("BOUNDED_ACTIVITY");
    return result("activity", facts, source, now, activityLoadState === "unavailable" || activityLoadState === "loading" ? "UNAVAILABLE" : activityLoadState === "partial" ? "PARTIAL" : "AVAILABLE", limitations);
  }
  let code: string | undefined;
  try { code = await client.getCode({ address: target }); } catch { limitations.push("CODE_UNAVAILABLE"); }
  facts.push({ label: "addressType", value: code && code !== "0x" ? "CONTRACT" : code === "0x" ? "EOA" : "UNKNOWN", sourceIds: [source.id] });
  limitations.push("ADDRESS_TYPE_NOT_SAFETY");
  if (input.operation === "address") {
    const balances = await Promise.all(SUPPORTED_ASSETS.map(async (asset) => {
      try { const value = await client.readContract({ address: asset.address, abi: erc20Abi, functionName: "balanceOf", args: [input.address] }) as bigint; return `${formatUnits(value, asset.decimals)} ${asset.symbol}`; } catch { return undefined; }
    }));
    balances.forEach((value) => { if (value) facts.push({ label: "balance", value, sourceIds: [source.id] }); });
    if (balances.some((value) => value === undefined)) limitations.push("BALANCE_PARTIAL");
    return result("address", facts, source, now, limitations.length > 1 ? "PARTIAL" : "AVAILABLE", limitations);
  }
  const known = getAssetByAddress(target);
  const reads = await Promise.allSettled([
    client.readContract({ address: target, abi: erc20Abi, functionName: "name" }), client.readContract({ address: target, abi: erc20Abi, functionName: "symbol" }), client.readContract({ address: target, abi: erc20Abi, functionName: "decimals" }), client.readContract({ address: target, abi: erc20Abi, functionName: "totalSupply" }), client.readContract({ address: target, abi: erc20Abi, functionName: "balanceOf", args: [input.address] }), ...(input.spender ? [client.readContract({ address: target, abi: erc20Abi, functionName: "allowance", args: [input.address, input.spender] })] : []),
  ]);
  const labels: AgentIntelligenceFact["label"][] = ["tokenName", "tokenSymbol", "tokenDecimals", "tokenSupply", "balance", "allowance"];
  reads.forEach((read, index) => { if (read.status === "fulfilled") facts.push({ label: labels[index], value: typeof read.value === "bigint" ? read.value.toString() : String(read.value), sourceIds: [source.id] }); else limitations.push("TOKEN_METADATA_PARTIAL"); });
  if (known) facts.push({ label: "protocol", value: `MAKOTO_SUPPORTED_ASSET:${known.id}`, sourceIds: [source.id] });
  else limitations.push("PROTOCOL_UNVERIFIED");
  limitations.push("NO_WALLET_WIDE_ALLOWANCE_SCAN");
  return result("token", facts, source, now, reads.some((read) => read.status === "rejected") ? "PARTIAL" : "AVAILABLE", limitations);
}

function result(summary: AgentIntelligenceResult["summary"], facts: AgentIntelligenceFact[], source: AgentResearchSource, now: number, status: AgentIntelligenceResult["status"], limitations: string[]): AgentIntelligenceResult { return Object.freeze({ kind: "onchain", status, summary, facts: Object.freeze(facts), sources: Object.freeze([source]), fetchedAt: now, expiresAt: now + (summary === "token" ? 300_000 : 30_000), limitations: Object.freeze([...new Set(limitations)]) }); }

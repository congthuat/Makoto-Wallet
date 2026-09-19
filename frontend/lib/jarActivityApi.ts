import { decodeEventLog, encodeEventTopics, isAddress, isHash, toHex, type Hex } from "viem";
import { penguJarV3Abi } from "./abi/penguJarV3.ts";
import type { JarActivityItem } from "./types.ts";

export const JAR_ACTIVITY_CONTRACT = "0x2d2C30ACe5d1f057C6eC2e2E8219A43355Dd226a" as const;
export const JAR_ACTIVITY_DEPLOYMENT_BLOCK = 56_927_475n;

export const JAR_ACTIVITY_RPC_ENDPOINTS = [
  { url: "https://rpc.blockdaemon.testnet.arc.io", maxBlocks: 100_001n },
  { url: "https://rpc.drpc.testnet.arc.io", maxBlocks: 10_000n },
  { url: "https://rpc.testnet.arc.io", maxBlocks: 10_000n },
  { url: "https://rpc.quicknode.testnet.arc.io", maxBlocks: 2_000n },
] as const;
const eventNames = ["JarCreated", "JarDeposited", "JarContributed", "JarWithdrawn"] as const;
export const JAR_ACTIVITY_EVENT_TOPICS = eventNames.map((eventName) => encodeEventTopics({ abi: penguJarV3Abi, eventName })[0]);
const eventTopics = JAR_ACTIVITY_EVENT_TOPICS;
const topicToName = new Map(eventTopics.map((topic, index) => [topic.toLowerCase(), eventNames[index]]));

type RpcLog = { address: Hex; blockNumber: Hex; data: Hex; logIndex: Hex; removed?: boolean; topics: [Hex, ...Hex[]]; transactionHash: Hex };
export type SerializedJarActivityItem = Omit<JarActivityItem, "amount" | "timestamp" | "blockNumber"> & { amount?: string; timestamp: string; blockNumber: string };
export type JarActivityApiResponse = { items: SerializedJarActivityItem[]; lastScannedBlock: string; creationBlock?: string };

export function parseJarActivitySearch(searchParams: URLSearchParams) {
  for (const key of searchParams.keys()) if (key !== "jarId" && key !== "fromBlock") throw new Error("Unsupported activity parameter.");
  const rawJarId = searchParams.get("jarId") ?? "";
  if (!/^[1-9]\d{0,77}$/.test(rawJarId)) throw new Error("Invalid jar ID.");
  const jarId = BigInt(rawJarId);
  if (jarId >= 2n ** 256n) throw new Error("Invalid jar ID.");
  const rawFromBlock = searchParams.get("fromBlock");
  if (rawFromBlock !== null && !/^\d{1,12}$/.test(rawFromBlock)) throw new Error("Invalid start block.");
  return { jarId, fromBlock: rawFromBlock === null ? undefined : BigInt(rawFromBlock) };
}

export function deserializeJarActivityResponse(payload: unknown): { items: JarActivityItem[]; lastScannedBlock: bigint; creationBlock?: bigint } {
  if (!isRecord(payload) || !Array.isArray(payload.items) || !isDecimal(payload.lastScannedBlock)) throw new Error("Invalid Jar Activity response.");
  const items = payload.items.map((value): JarActivityItem => {
    if (!isRecord(value) || typeof value.id !== "string" || !["created", "deposit", "contribution", "withdrawal"].includes(String(value.type)) || typeof value.actor !== "string" || !isAddress(value.actor) || !isDecimal(value.timestamp) || !isDecimal(value.blockNumber) || typeof value.transactionHash !== "string" || !isHash(value.transactionHash) || typeof value.logIndex !== "number" || !Number.isSafeInteger(value.logIndex) || value.logIndex < 0 || (value.amount !== undefined && !isDecimal(value.amount))) throw new Error("Invalid Jar Activity item.");
    return { id: value.id, type: value.type as JarActivityItem["type"], actor: value.actor, ...(value.amount === undefined ? {} : { amount: BigInt(value.amount) }), timestamp: BigInt(value.timestamp), transactionHash: value.transactionHash, blockNumber: BigInt(value.blockNumber), logIndex: value.logIndex };
  });
  return { items, lastScannedBlock: BigInt(payload.lastScannedBlock), ...(isDecimal(payload.creationBlock) ? { creationBlock: BigInt(payload.creationBlock) } : {}) };
}

export async function loadJarActivity(options: { jarId: bigint; fromBlock?: bigint; fetchFn?: typeof fetch; endpoints?: readonly { url: string; maxBlocks: bigint }[] }): Promise<JarActivityApiResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const endpoints = options.endpoints ?? JAR_ACTIVITY_RPC_ENDPOINTS;
  const latestHex = await rpcWithFailover<Hex>(endpoints, "eth_blockNumber", [], fetchFn, "latest-block");
  const latest = BigInt(latestHex);
  if (latest < JAR_ACTIVITY_DEPLOYMENT_BLOCK) return { items: [], lastScannedBlock: latest.toString() };
  let fromBlock = options.fromBlock;
  let creationBlock: bigint | undefined;
  let logs: RpcLog[];
  if (fromBlock === undefined) {
    const recentFrom = maxBigInt(JAR_ACTIVITY_DEPLOYMENT_BLOCK, latest - 100_000n);
    const recentLogs = await getLogsRange(options.jarId, recentFrom, latest, endpoints, fetchFn);
    creationBlock = creationBlockFrom(recentLogs);
    if (creationBlock !== undefined) { fromBlock = creationBlock; logs = recentLogs.filter((log) => BigInt(log.blockNumber) >= creationBlock!); }
    else { fromBlock = JAR_ACTIVITY_DEPLOYMENT_BLOCK; logs = await getLogsChunked(options.jarId, fromBlock, latest, endpoints, fetchFn); creationBlock = creationBlockFrom(logs); }
  } else {
    fromBlock = minBigInt(maxBigInt(fromBlock, JAR_ACTIVITY_DEPLOYMENT_BLOCK), latest);
    logs = await getLogsChunked(options.jarId, fromBlock, latest, endpoints, fetchFn);
  }
  const timestamps = new Map<bigint, bigint>();
  for (const blockNumber of [...new Set(logs.map((log) => BigInt(log.blockNumber)))]) {
    const block = await rpcWithFailover<{ timestamp: Hex }>(endpoints, "eth_getBlockByNumber", [toHex(blockNumber), false], fetchFn, "block-timestamp");
    timestamps.set(blockNumber, BigInt(block.timestamp));
  }
  return { items: normalizeLogs(logs, timestamps).map(serializeItem), lastScannedBlock: latest.toString(), ...(creationBlock === undefined ? {} : { creationBlock: creationBlock.toString() }) };
}

async function getLogsChunked(jarId: bigint, fromBlock: bigint, toBlock: bigint, endpoints: readonly { url: string; maxBlocks: bigint }[], fetchFn: typeof fetch) {
  const logs: RpcLog[] = [];
  for (let start = fromBlock; start <= toBlock; start += 10_000n) logs.push(...await getLogsRange(jarId, start, minBigInt(start + 9_999n, toBlock), endpoints, fetchFn));
  return dedupeLogs(logs);
}

async function getLogsRange(jarId: bigint, fromBlock: bigint, toBlock: bigint, endpoints: readonly { url: string; maxBlocks: bigint }[], fetchFn: typeof fetch): Promise<RpcLog[]> {
  const blockCount = toBlock - fromBlock + 1n;
  const compatible = endpoints.filter((endpoint) => endpoint.maxBlocks >= blockCount);
  if (compatible.length === 0) return getLogsChunked(jarId, fromBlock, toBlock, endpoints, fetchFn);
  const filter = { address: JAR_ACTIVITY_CONTRACT, topics: [eventTopics, toHex(jarId, { size: 32 })], fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) };
  try { return await rpcWithFailover<RpcLog[]>(compatible, "eth_getLogs", [filter], fetchFn, "jar-events"); }
  catch (error) {
    if (blockCount > 10_000n && endpoints.some((endpoint) => endpoint.maxBlocks >= 10_000n)) return getLogsChunked(jarId, fromBlock, toBlock, endpoints, fetchFn);
    throw error;
  }
}

async function rpcWithFailover<T>(endpoints: readonly { url: string }[], method: string, params: unknown[], fetchFn: typeof fetch, operation: string): Promise<T> {
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const response = await fetchFn(endpoint.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const payload = await response.json() as { result?: T; error?: { code?: number; message?: string } };
      if (!response.ok || payload.error || payload.result === undefined) throw new Error(`HTTP ${response.status}; RPC ${payload.error?.code ?? "unknown"}: ${payload.error?.message ?? "invalid response"}`);
      return payload.result;
    } catch (error) {
      lastError = error;
      if (process.env.NODE_ENV === "development") console.warn("[Makoto Jar Activity]", { endpoint: endpoint.url, operation, category: rpcCategory(error) });
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Jar Activity RPC endpoints failed.");
}

function normalizeLogs(logs: RpcLog[], timestamps: Map<bigint, bigint>): JarActivityItem[] {
  return dedupeLogs(logs).flatMap((log): JarActivityItem[] => {
    if (log.removed || log.address.toLowerCase() !== JAR_ACTIVITY_CONTRACT.toLowerCase() || log.topics.length < 2 || !topicToName.has(log.topics[0].toLowerCase())) return [];
    const eventName = topicToName.get(log.topics[0].toLowerCase())!;
    const decoded = decodeEventLog({ abi: penguJarV3Abi, data: log.data, topics: log.topics });
    const args = decoded.args as Record<string, unknown>;
    const actor = eventName === "JarCreated" || eventName === "JarWithdrawn" ? args.owner : eventName === "JarDeposited" ? args.from : args.contributor;
    const blockNumber = BigInt(log.blockNumber);
    const timestamp = timestamps.get(blockNumber);
    if (typeof actor !== "string" || !isAddress(actor) || timestamp === undefined || !isHash(log.transactionHash)) return [];
    const logIndex = Number(BigInt(log.logIndex));
    const amount = eventName === "JarCreated" ? undefined : args.amount;
    return [{ id: `${log.transactionHash}-${logIndex}`, type: eventName === "JarCreated" ? "created" : eventName === "JarDeposited" ? "deposit" : eventName === "JarContributed" ? "contribution" : "withdrawal", actor, ...(typeof amount === "bigint" ? { amount } : {}), timestamp, transactionHash: log.transactionHash, blockNumber, logIndex }];
  }).sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1);
}

function creationBlockFrom(logs: RpcLog[]) { const log = logs.find((value) => value.topics[0]?.toLowerCase() === eventTopics[0].toLowerCase()); return log ? BigInt(log.blockNumber) : undefined; }
function dedupeLogs(logs: RpcLog[]) { const map = new Map<string, RpcLog>(); for (const log of logs) map.set(`${log.transactionHash}:${log.logIndex}`, log); return [...map.values()]; }
function serializeItem(item: JarActivityItem): SerializedJarActivityItem { const { amount, timestamp, blockNumber, ...rest } = item; return { ...rest, ...(amount === undefined ? {} : { amount: amount.toString() }), timestamp: timestamp.toString(), blockNumber: blockNumber.toString() }; }
function rpcCategory(error: unknown) { const message = error instanceof Error ? error.message : String(error); return /429|rate/i.test(message) ? "rate-limit" : /range|blocks|413/i.test(message) ? "range-limit" : /pruned/i.test(message) ? "pruned-history" : /timeout/i.test(message) ? "timeout" : "rpc-error"; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isDecimal(value: unknown): value is string { return typeof value === "string" && /^\d+$/.test(value); }
function minBigInt(a: bigint, b: bigint) { return a < b ? a : b; }
function maxBigInt(a: bigint, b: bigint) { return a > b ? a : b; }

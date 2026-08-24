import { createPublicClient, getAddress, http, parseAbiItem, toFunctionSelector, type Address, type Hash, type PublicClient } from "viem";
import { arcTestnet } from "viem/chains";

import { SUPPORTED_ASSETS } from "../assets.ts";
import { arcRpcUrl } from "../config.ts";
import { CCTP_TOKEN_MESSENGER_ABI, CCTP_TOKEN_MESSENGER_V2, CCTP_TOKEN_MINTER_V2 } from "../cctp.ts";
import { groupXyloSwaps, normalizeWalletActivities } from "../onchainActivity.ts";
import type { WalletActivity } from "../wallet.ts";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const CCTP_SELECTOR = toFunctionSelector(CCTP_TOKEN_MESSENGER_ABI[0]);
export const RPC_ACTIVITY_BLOCK_WINDOW = 10_000n;

export async function loadRecentRpcActivity(wallet: Address, vaultAddress?: Address, client: PublicClient = createPublicClient({ chain: arcTestnet, transport: http(arcRpcUrl, { timeout: 10_000 }) })) {
  const latest = await client.getBlockNumber();
  const fromBlock = latest >= RPC_ACTIVITY_BLOCK_WINDOW ? latest - RPC_ACTIVITY_BLOCK_WINDOW + 1n : 0n;
  const logs = (await Promise.all(SUPPORTED_ASSETS.flatMap((asset) => [
    client.getLogs({ address: asset.address, event: TRANSFER, args: { from: wallet }, fromBlock, toBlock: latest, strict: true }),
    client.getLogs({ address: asset.address, event: TRANSFER, args: { to: wallet }, fromBlock, toBlock: latest, strict: true }),
  ]))).flat();
  const normalizedWallet = getAddress(wallet);
  const blocks = new Map<bigint, number>();
  await Promise.all([...new Set(logs.map((log) => log.blockNumber))].map(async (blockNumber) => {
    const block = await client.getBlock({ blockNumber });
    blocks.set(blockNumber, Number(block.timestamp) * 1000);
  }));
  const bridgeEvidence = new Set<Hash>();
  await Promise.all([...new Set(logs.filter((log) => log.args.from && getAddress(log.args.from) === normalizedWallet && log.args.to && getAddress(log.args.to) === CCTP_TOKEN_MINTER_V2).map((log) => log.transactionHash).filter(Boolean) as Hash[])].map(async (hash) => {
    const transaction = await client.getTransaction({ hash });
    if (transaction.to && getAddress(transaction.to) === CCTP_TOKEN_MESSENGER_V2 && transaction.input.startsWith(CCTP_SELECTOR)) bridgeEvidence.add(hash);
  }));
  const records: WalletActivity[] = [];
  for (const log of logs) {
    if (!log.transactionHash || log.logIndex === null || log.args.value === undefined || !log.args.from || !log.args.to || log.args.value <= 0n) continue;
    const asset = SUPPORTED_ASSETS.find((item) => item.address === getAddress(log.address));
    if (!asset) continue;
    const from = getAddress(log.args.from), to = getAddress(log.args.to);
    const isFrom = from === normalizedWallet, isTo = to === normalizedWallet;
    if (isFrom === isTo) continue;
    const counterparty = isFrom ? to : from;
    const isVault = Boolean(vaultAddress && counterparty === vaultAddress);
    const isBridge = isFrom && asset.id === "usdc" && to === CCTP_TOKEN_MINTER_V2 && bridgeEvidence.has(log.transactionHash);
    records.push({
      hash: log.transactionHash, logIndex: log.logIndex, direction: isFrom ? "send" : "receive",
      kind: isBridge ? "bridge" : isVault ? (isFrom ? "vault-deposit" : "vault-withdraw") : "transfer",
      amount: log.args.value, counterparty, confirmedAt: blocks.get(log.blockNumber) ?? 0, blockNumber: log.blockNumber,
      assetId: asset.id, assetSymbol: asset.symbol, tokenAddress: asset.address, decimals: asset.decimals,
      source: "onchain", provider: "rpc",
    });
  }
  return normalizeWalletActivities(groupXyloSwaps(records), 100);
}

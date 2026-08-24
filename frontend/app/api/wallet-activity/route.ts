import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { decodeArcScanCursor, groupXyloSwaps, normalizeWalletActivities, parseArcScanActivity, serializeWalletActivityPage, type WalletActivityPage } from "@/lib/onchainActivity";
import { contractAddress } from "@/lib/config";
import { loadRecentRpcActivity } from "@/lib/indexer/rpcFallback";

export const dynamic = "force-dynamic";

const ARCSCAN_API = "https://testnet.arcscan.app/api/v2";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const rawAddress = request.nextUrl.searchParams.get("address") ?? "";
  if (!isAddress(rawAddress)) return errorResponse("Invalid wallet address.", 400);

  const cursorValue = request.nextUrl.searchParams.get("cursor");
  const cursor = cursorValue ? decodeArcScanCursor(cursorValue) : undefined;
  if (cursorValue && !cursor) return errorResponse("Invalid activity cursor.", 400);

  const address = getAddress(rawAddress);
  const upstreamUrl = new URL(`${ARCSCAN_API}/addresses/${address}/token-transfers`);
  upstreamUrl.searchParams.set("type", "ERC-20");
  if (cursor) {
    upstreamUrl.searchParams.set("block_number", String(cursor.block_number));
    upstreamUrl.searchParams.set("index", String(cursor.index));
  }

  const arcscanRequest = async () => {
    const response = await fetch(upstreamUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("ArcScan request failed");
    return parseArcScanActivity(await response.json(), address, contractAddress);
  };

  const [arcscan, rpc] = await Promise.allSettled([
    arcscanRequest(),
    cursor ? Promise.resolve([]) : loadRecentRpcActivity(address, contractAddress),
  ]);
  if (arcscan.status === "rejected" && (cursor || rpc.status === "rejected")) return errorResponse("On-chain history is temporarily unavailable.", 502);

  const arcscanPage = arcscan.status === "fulfilled" ? arcscan.value : undefined;
  const rpcRecords = rpc.status === "fulfilled" ? rpc.value : [];
  const page: WalletActivityPage = {
    activities: normalizeWalletActivities(groupXyloSwaps([...(arcscanPage?.activities ?? []), ...rpcRecords]), 100),
    ...(arcscanPage?.nextCursor ? { nextCursor: arcscanPage.nextCursor } : {}),
    ...(arcscanPage ? { provider: rpcRecords.length ? "arcscan+rpc" : "arcscan" } : { provider: "rpc", partial: true }),
  };
  return NextResponse.json(serializeWalletActivityPage(page), { headers: { "Cache-Control": "private, no-store" } });
}

import { NextRequest, NextResponse } from "next/server";

import { ARC_CCTP_DOMAIN } from "@/lib/cctp";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const txHash = request.nextUrl.searchParams.get("txHash") ?? "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return NextResponse.json({ error: "Invalid transaction hash." }, { status: 400 });

  const url = `https://iris-api-sandbox.circle.com/v2/messages/${ARC_CCTP_DOMAIN}?transactionHash=${txHash}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    return NextResponse.json({ status: "pending" }, { headers: { "Cache-Control": "no-store" } });
  }

  if (response.status === 404) return NextResponse.json({ status: "pending" }, { headers: { "Cache-Control": "no-store" } });
  if (!response.ok) return NextResponse.json({ status: "pending" }, { headers: { "Cache-Control": "no-store" } });

  const payload = await response.json().catch(() => undefined) as { messages?: Array<{ status?: unknown; attestation?: unknown; forwardingState?: unknown; forwardingStatus?: unknown; forwardTxHash?: unknown }> } | undefined;
  const message = payload?.messages?.[0];
  const messageStatus = typeof message?.status === "string" ? message.status : "pending";
  const forwardTxHash = typeof message?.forwardTxHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(message.forwardTxHash)
    ? message.forwardTxHash
    : undefined;
  const forwardingState = typeof message?.forwardingState === "string"
    ? message.forwardingState
    : typeof message?.forwardingStatus === "string"
      ? message.forwardingStatus
      : forwardTxHash ? "submitted" : "pending";
  const attestationStatus = typeof message?.attestation === "string" && message.attestation.startsWith("0x") ? "available" : messageStatus;
  return NextResponse.json({ status: forwardTxHash ? "complete" : messageStatus, messageStatus, attestationStatus, forwardingState, forwardTxHash }, { headers: { "Cache-Control": "no-store" } });
}

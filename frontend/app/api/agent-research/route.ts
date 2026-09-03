import { NextRequest, NextResponse } from "next/server";
import { getOfficialSource, retrieveOfficialSource, sourceErrorResult, unsupportedArcRecentResult } from "@/lib/agent/intelligence/officialSources";
import type { AgentIntelligenceResult } from "@/lib/agent/intelligence/types";

export const dynamic = "force-dynamic";
const responseCache = new Map<string, { expiresAt: number; value: AgentIntelligenceResult }>();

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("url") || [...request.nextUrl.searchParams.keys()].some((key) => !["source", "topic"].includes(key))) return NextResponse.json({ error: "Only an approved source ID and bounded topic are accepted." }, { status: 400 });
  const sourceId = request.nextUrl.searchParams.get("source") ?? "";
  const topic = request.nextUrl.searchParams.get("topic");
  if (topic && topic !== "bridging") return NextResponse.json({ error: "Unknown approved research topic." }, { status: 400 });
  if (sourceId === "arc-updates") return NextResponse.json(unsupportedArcRecentResult(Date.now()), { status: 422, headers: { "Cache-Control": "private, max-age=300" } });
  const source = getOfficialSource(sourceId);
  if (!source) return NextResponse.json({ error: "Unknown approved source." }, { status: 404 });
  const cacheKey = `${source.id}:${topic ?? "general"}`, cached = responseCache.get(cacheKey), now = Date.now();
  if (cached && cached.expiresAt > now) return NextResponse.json(cached.value, { headers: { "Cache-Control": `private, max-age=${Math.min(60, source.ttlSeconds)}` } });
  try {
    const value = await retrieveOfficialSource(source, fetch, now, topic === "bridging" ? topic : undefined);
    responseCache.set(cacheKey, { value, expiresAt: now + source.ttlSeconds * 1000 });
    return NextResponse.json(value, { headers: { "Cache-Control": `private, max-age=${Math.min(300, source.ttlSeconds)}` } });
  } catch {
    return NextResponse.json(sourceErrorResult(source, now), { status: 502, headers: { "Cache-Control": "private, max-age=20" } });
  }
}

import { classifyPlannerRequest } from "../../../lib/plannerSemanticClassifier.ts";
import { createOpenAIPlannerClassifier } from "../../../lib/openaiPlannerClassifier.server.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  const input: unknown = raw.length <= 8_192 ? (() => { try { return JSON.parse(raw); } catch { return undefined; } })() : undefined;
  const result = await classifyPlannerRequest(input, createOpenAIPlannerClassifier());
  if (result.ok) return Response.json({ classification: result.classification }, { status: result.classification.status === "INVALID_INPUT" ? 400 : 200, headers: { "Cache-Control": "no-store" } });
  return Response.json({ error: result.error }, { status: result.error === "PROVIDER_UNAVAILABLE" ? 503 : 502, headers: { "Cache-Control": "no-store" } });
}

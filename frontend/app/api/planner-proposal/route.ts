import { runPlannerProposal } from "../../../lib/plannerProposalPipeline.ts";
import { createOpenAIPlannerClassifier } from "../../../lib/openaiPlannerClassifier.server.ts";
import { createOpenAIPlannerPlanGenerator } from "../../../lib/openaiPlannerPlanGenerator.server.ts";
import { createOpenAIPlannerParameterResolver } from "../../../lib/openaiPlannerParameterResolver.server.ts";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  let input: unknown;
  if (raw.length <= 8192) try { input = JSON.parse(raw); } catch { /* invalid request */ }
  const result = await runPlannerProposal(input, {
    classifier: createOpenAIPlannerClassifier(), generator: createOpenAIPlannerPlanGenerator(),
    resolver: createOpenAIPlannerParameterResolver(), newId: () => crypto.randomUUID(),
  });
  const status = result.status === "PROPOSAL" ? 200 : result.status === "INVALID_REQUEST" ? 400 : result.status === "NOT_APPLICABLE" ? 422 : result.status.endsWith("PROVIDER_UNAVAILABLE") ? 503 : 502;
  return Response.json(result, { status, headers });
}

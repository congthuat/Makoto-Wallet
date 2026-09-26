import { runPlannerProposal } from "../../../lib/plannerProposalPipeline.ts";
import { createOpenAIPlannerClassifier } from "../../../lib/openaiPlannerClassifier.server.ts";
import { createOpenAIPlannerPlanGenerator } from "../../../lib/openaiPlannerPlanGenerator.server.ts";
import { createOpenAIPlannerParameterResolver } from "../../../lib/openaiPlannerParameterResolver.server.ts";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 8_192;

/** Stop reading once the existing bounded Planner request envelope is exceeded. */
async function readBody(request: Request): Promise<string | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, body = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) return body + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > MAX_BODY_BYTES) { await reader.cancel().catch(() => {}); return undefined; }
      body += decoder.decode(part.value, { stream: true });
    }
  } catch { return undefined; }
  finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  const raw = await readBody(request);
  let input: unknown;
  if (raw !== undefined) try { input = JSON.parse(raw); } catch { /* invalid request */ }
  const result = await runPlannerProposal(input, {
    classifier: createOpenAIPlannerClassifier(), generator: createOpenAIPlannerPlanGenerator(),
    resolver: createOpenAIPlannerParameterResolver(), newId: () => crypto.randomUUID(),
  });
  const status = result.status === "PROPOSAL" ? 200 : result.status === "INVALID_REQUEST" ? 400 : result.status === "NOT_APPLICABLE" ? 422 : result.status.endsWith("PROVIDER_UNAVAILABLE") ? 503 : 502;
  return Response.json(result, { status, headers });
}

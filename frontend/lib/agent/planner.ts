import type { AgentContextSnapshot, AgentRequest, AgentResponse } from "./types.ts";
import { formatAgentResponse } from "./formatter.ts";
import { parseAgentRequest } from "./parser.ts";
import { runAgentTool } from "./tools.ts";
import type { AgentPlanningResult } from "./planning.ts";

export function answerAgentRequest(snapshot: AgentContextSnapshot, request: AgentRequest, planning?: AgentPlanningResult): AgentResponse {
  const intent = parseAgentRequest(request);
  return formatAgentResponse(snapshot, intent, runAgentTool(snapshot, intent, planning));
}

import type { AgentContextSnapshot, AgentRequest, AgentResponse } from "./types.ts";
import { formatAgentResponse } from "./formatter.ts";
import { parseAgentRequest } from "./parser.ts";
import { runAgentTool } from "./tools.ts";

export function answerAgentRequest(snapshot: AgentContextSnapshot, request: AgentRequest): AgentResponse {
  const intent = parseAgentRequest(request);
  return formatAgentResponse(snapshot, intent, runAgentTool(snapshot, intent));
}

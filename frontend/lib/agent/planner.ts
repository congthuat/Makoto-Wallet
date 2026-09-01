import type { AgentContextSnapshot, AgentIntent, AgentResponse } from "./types.ts";
import { formatAgentResponse } from "./formatter.ts";
import type { AgentOrchestrationDecision } from "./orchestration.ts";
import type { AgentCapabilityOutput } from "./tools.ts";

export function answerAgentRequest(snapshot: AgentContextSnapshot, intent: AgentIntent, decision: AgentOrchestrationDecision, output: AgentCapabilityOutput): AgentResponse {
  return formatAgentResponse(snapshot, intent, decision, output);
}

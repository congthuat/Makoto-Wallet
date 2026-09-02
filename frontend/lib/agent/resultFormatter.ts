import { translate, type Locale } from "../../i18n/index.ts";
import type { AgentActionResult } from "./actions/index.ts";

export function formatAgentActionResult(result: AgentActionResult, locale: Locale) {
  if (result.status === "cancelled") return translate(locale, "agent.result.cancelled");
  if (result.status === "failed") return translate(locale, "agent.result.failed");
  if (result.status === "unknown") return translate(locale, "agent.result.unknown");
  const title = translate(locale, ({ send: "agent.result.sendConfirmed", swap: "agent.result.swapConfirmed", bridge: "agent.result.bridgeConfirmed", "vault-deposit": "agent.result.vaultDepositConfirmed", "vault-withdraw": "agent.result.vaultWithdrawConfirmed" } as const)[result.action]);
  const amount = result.amount && result.asset ? `\n${result.amount} ${result.asset}${result.outputAmount && result.outputAsset ? ` → ${result.outputAmount} ${result.outputAsset}` : ""}` : "";
  return `${title}${amount}${result.transactionHash ? `\n${translate(locale, "agent.result.transaction")} ${result.transactionHash}` : ""}`;
}

import { translate, type Locale, type TranslationKey } from "@/i18n";
import { presentAgentStatus, type AgentStatusInput } from "@/lib/agentStatusPresentation";
import styles from "./MakotoAgentPage.module.css";

/** No controls: historical state and recovery advice cannot trigger wallet work. */
export function AgentStatusSurface({ input, locale }: { input: AgentStatusInput; locale: Locale }) {
  const status = presentAgentStatus(input);
  const label = translate(locale, `agent.status.${status.status}` as TranslationKey);
  const detail = translate(locale, `agent.status.detail.${status.status}` as TranslationKey);
  return <section className={styles.agentStatus} role="status" aria-label={translate(locale, "agent.status.heading")} data-agent-status={status.status} data-historical={status.historical}>
    <strong>{label}</strong>
    {status.historical && <span>{translate(locale, "agent.status.historical")}</span>}
    <p>{detail}</p>
    {status.historical && <p>{translate(locale, "agent.status.historicalDetail")}</p>}
    {status.sourceOnly && <p>{translate(locale, "agent.status.sourceOnly")}</p>}
    {status.hash && <p className={styles.statusHash}>{translate(locale, "agent.status.hash")}: {status.hash}</p>}
  </section>;
}

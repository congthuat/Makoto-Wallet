import type { Locale } from "@/i18n";
import type { PolicyResult } from "@/lib/policyEngine";
import { mapPolicyResultToUX } from "@/lib/policyUX";

export function PolicyDecisionNotice({ result, locale }: { result: PolicyResult; locale: Locale }) {
  const state = mapPolicyResultToUX(result, locale);
  return <section className="review-limitations" aria-label={state.title} role={state.blocksProgression ? "alert" : "status"} data-policy-decision={state.decision}>
    <h4>{state.title}</h4>
    <p>{state.summary}</p>
    {state.reasons.length > 0 && <ul>{state.reasons.map((reason, index) => <li key={`${reason.code}:${reason.evidence}:${index}`}>{reason.text}</li>)}</ul>}
    <p>{state.nextAction}</p>
  </section>;
}

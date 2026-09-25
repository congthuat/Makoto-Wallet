import { validatePlannerRequestClassification, type PlannerRequestClassification } from "./plannerRequestClassification.ts";

export type PlannerClassificationRequest = Readonly<{ text: string; locale?: "en" | "vi" }>;
/** Provider output remains untrusted until the deterministic validator accepts it. */
export interface PlannerSemanticClassifier {
  classify(request: PlannerClassificationRequest): Promise<unknown>;
}
export type PlannerClassificationResult =
  | Readonly<{ ok: true; classification: PlannerRequestClassification }>
  | Readonly<{ ok: false; error: "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_OUTPUT" }>;

export const MAX_CLASSIFICATION_TEXT_LENGTH = 2_000;

export function validatePlannerClassificationRequest(input: unknown): PlannerClassificationRequest | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) return undefined;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== "text" && key !== "locale") ||
    typeof value.text !== "string" || !value.text.trim() || value.text.length > MAX_CLASSIFICATION_TEXT_LENGTH ||
    (value.locale !== undefined && value.locale !== "en" && value.locale !== "vi")) return undefined;
  return Object.freeze({ text: value.text.trim(), ...(value.locale ? { locale: value.locale } : {}) });
}

export async function classifyPlannerRequest(input: unknown, classifier: PlannerSemanticClassifier): Promise<PlannerClassificationResult> {
  const request = validatePlannerClassificationRequest(input);
  if (!request) return { ok: true, classification: { status: "INVALID_INPUT" } };
  let untrusted: unknown;
  try { untrusted = await classifier.classify(request); }
  catch { return { ok: false, error: "PROVIDER_UNAVAILABLE" }; }
  const validated = validatePlannerRequestClassification(untrusted);
  return validated.valid && validated.value.status !== "INVALID_INPUT"
    ? { ok: true, classification: validated.value }
    : { ok: false, error: "INVALID_PROVIDER_OUTPUT" };
}

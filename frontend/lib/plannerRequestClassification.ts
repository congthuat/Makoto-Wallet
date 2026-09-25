/** Phase 11B describes user-level goals, before PlannerIntent resolution. */
export type PlannerRequestCategory = "INFORMATION" | "ACTION" | "STRATEGY";

export type PlannerRequestClassification =
  | Readonly<{ status: "CLASSIFIED"; category: PlannerRequestCategory }>
  | Readonly<{ status: "AMBIGUOUS" | "UNSUPPORTED" | "INVALID_INPUT" }>;

export type ClassificationValidationResult =
  | Readonly<{ valid: true; value: PlannerRequestClassification }>
  | Readonly<{ valid: false; error: "INVALID_SCHEMA" }>;

/** Validate untrusted classifier output. No explanation or execution fields are admitted. */
export function validatePlannerRequestClassification(input: unknown): ClassificationValidationResult {
  if (input === null || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
    return { valid: false, error: "INVALID_SCHEMA" };
  }
  const value = input as Record<string, unknown>;
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !Object.getOwnPropertyDescriptor(value, key)?.enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) {
    return { valid: false, error: "INVALID_SCHEMA" };
  }
  const status = value.status;
  if (status === "CLASSIFIED") {
    if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "category") ||
      (value.category !== "INFORMATION" && value.category !== "ACTION" && value.category !== "STRATEGY")) {
      return { valid: false, error: "INVALID_SCHEMA" };
    }
    return { valid: true, value: Object.freeze({ status, category: value.category }) };
  }
  if (status === "AMBIGUOUS" || status === "UNSUPPORTED" || status === "INVALID_INPUT") {
    if (Object.keys(value).length !== 1) return { valid: false, error: "INVALID_SCHEMA" };
    return { valid: true, value: Object.freeze({ status }) };
  }
  return { valid: false, error: "INVALID_SCHEMA" };
}

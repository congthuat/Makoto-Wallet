export type ActivityLoadState = Readonly<{
  status: "loading" | "loaded" | "partial" | "unavailable";
  unavailable: boolean;
  partial: boolean;
}>;

export function deriveActivityLoadState(input: Readonly<{
  hasSuccessfulLoad: boolean;
  requestFailed: boolean;
  pagePartial: boolean;
}>): ActivityLoadState {
  const unavailable = input.requestFailed && !input.hasSuccessfulLoad;
  const status = unavailable ? "unavailable" : !input.hasSuccessfulLoad ? "loading" : input.pagePartial || input.requestFailed ? "partial" : "loaded";
  return Object.freeze({
    status,
    unavailable,
    partial: !unavailable && (input.pagePartial || input.requestFailed),
  });
}

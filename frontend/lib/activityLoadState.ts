export type ActivityLoadState = Readonly<{
  unavailable: boolean;
  partial: boolean;
}>;

export function deriveActivityLoadState(input: Readonly<{
  hasSuccessfulLoad: boolean;
  requestFailed: boolean;
  pagePartial: boolean;
}>): ActivityLoadState {
  const unavailable = input.requestFailed && !input.hasSuccessfulLoad;
  return Object.freeze({
    unavailable,
    partial: !unavailable && (input.pagePartial || input.requestFailed),
  });
}

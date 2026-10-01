export type TransactionReceiptStatus = { status: "success" | "reverted" };

export async function confirmThenRefresh<T extends TransactionReceiptStatus>(options: {
  receipt: Promise<T>;
  onConfirmed(receipt: T): void;
  refresh(): Promise<unknown>;
  onRefreshError?(error: unknown): void;
}): Promise<T> {
  const receipt = await options.receipt;
  if (receipt.status !== "success") throw new Error("Transaction receipt reported a revert.");

  options.onConfirmed(receipt);
  queueMicrotask(() => {
    void options.refresh().catch((error) => {
      (options.onRefreshError ?? defaultRefreshError)(error);
    });
  });
  return receipt;
}

function defaultRefreshError(error: unknown) {
  console.error("[Makoto] Confirmed transaction background refresh failed.", error);
}

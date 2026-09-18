import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "../i18n/index.ts";
import type { UnifiedBalance } from "./circle/types.ts";
import { formatUnifiedBalanceAmount, normalizeCircleBalances, unifiedBalanceEvidence, unifiedBalanceSourcesState } from "./circle/unifiedBalance.ts";

const wallet = "0x1111111111111111111111111111111111111111";
const balance = (available: bigint, pending: bigint | undefined, sources: UnifiedBalance["sources"] = []): UnifiedBalance => ({ available, pending, total: pending === undefined ? undefined : available + pending, sources });

test("H5 unknown balance never formats as numeric zero or a no-deposit conclusion", () => {
  const unavailable = translate("en", "overview.unavailable");
  assert.equal(unifiedBalanceEvidence(undefined), "unknown");
  assert.equal(formatUnifiedBalanceAmount(undefined, unavailable), unavailable);
  assert.equal(unifiedBalanceSourcesState(undefined), "unavailable");
  assert.notEqual(formatUnifiedBalanceAmount(undefined, unavailable), "0");
});

test("H5 missing pending evidence stays unavailable instead of becoming Pending 0", () => {
  const current = balance(0n, undefined);
  const unavailable = translate("en", "overview.unavailable");
  assert.equal(unifiedBalanceEvidence(current), "unknown");
  assert.equal(formatUnifiedBalanceAmount(current.pending, unavailable), unavailable);
  assert.equal(unifiedBalanceSourcesState(current), "unavailable");
});

test("H5 explicit zero is still a known zero and preserves the empty state", () => {
  const current = balance(0n, 0n);
  assert.equal(unifiedBalanceEvidence(current), "known-zero");
  assert.equal(formatUnifiedBalanceAmount(current.available, translate("vi", "overview.unavailable")), "0");
  assert.equal(formatUnifiedBalanceAmount(current.pending, translate("vi", "overview.unavailable")), "0");
  assert.equal(unifiedBalanceSourcesState(current), "empty");
});

test("H5 known positive balance keeps its amount and source evidence", () => {
  const current = balance(1_250_000n, 0n, [{ domain: 26, chain: "Arc_Testnet", amount: 1_250_000n }]);
  assert.equal(unifiedBalanceEvidence(current), "known-non-zero");
  assert.equal(formatUnifiedBalanceAmount(current.available, "Unavailable"), "1.25");
  assert.equal(unifiedBalanceSourcesState(current), "available");
});

test("H5 transitions are truthful in both directions", () => {
  const known = balance(2_000_000n, 0n);
  assert.deepEqual([unifiedBalanceEvidence(undefined), unifiedBalanceEvidence(known)], ["unknown", "known-non-zero"]);
  assert.deepEqual([unifiedBalanceEvidence(known), unifiedBalanceEvidence(undefined)], ["known-non-zero", "unknown"]);
});

test("H5 Circle normalization preserves an omitted pending field as unknown", () => {
  const normalized = normalizeCircleBalances({ token: "USDC", totalConfirmedBalance: "0", breakdown: [] } as Parameters<typeof normalizeCircleBalances>[0], wallet);
  assert.equal(normalized.available, 0n);
  assert.equal(normalized.pending, undefined);
  assert.equal(normalized.total, undefined);
});

test("H5 unavailable status is localized in English and Vietnamese", () => {
  assert.equal(formatUnifiedBalanceAmount(undefined, translate("en", "overview.unavailable")), "Unavailable");
  assert.equal(formatUnifiedBalanceAmount(undefined, translate("vi", "overview.unavailable")), "Không khả dụng");
  assert.equal(translate("en", "walletHome.loadingBalance"), "Loading balance");
  assert.equal(translate("vi", "walletHome.loadingBalance"), "Đang tải số dư");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const panel = readFileSync(new URL("../components/ActivityHistoryPanel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");

const activityKeys = [
  "activityHistory.title", "activityHistory.synced", "activityHistory.partial",
  "activityHistory.searchLabel", "activityHistory.searchPlaceholder", "activityHistory.loading",
  "activityHistory.unavailable", "activityHistory.emptyTitle", "activityHistory.emptyCopy",
  "activityHistory.noResults", "activityHistory.partialUnavailable", "activityHistory.partialCopy",
  "activityHistory.loadMore", "activityHistory.loadingMore", "activityHistory.filter.all",
  "activityHistory.filter.send", "activityHistory.filter.receive", "activityHistory.filter.swap",
  "activityHistory.filter.bridge", "activityHistory.filter.vault", "activityHistory.action.swap",
  "activityHistory.action.bridge", "activityHistory.action.vaultDeposit", "activityHistory.action.vaultWithdraw",
  "activityHistory.action.send", "activityHistory.action.receive", "activityHistory.status.confirmed",
  "activityHistory.status.confirmedLocal", "activityHistory.route", "activityHistory.protocol",
  "activityHistory.network", "activityHistory.time", "activityHistory.transaction",
  "activityHistory.evidence", "activityHistory.evidenceSummary", "activityHistory.from",
  "activityHistory.to", "activityHistory.viewOnArcScan", "activityHistory.swapProtocol",
  "activityHistory.bridgeRoute", "activityHistory.vaultName",
] as const;

test("Phase 7H activity presentation localizes the full-history hierarchy in EN and VI", () => {
  for (const dictionary of [en, vi]) {
    for (const key of activityKeys) assert.equal(typeof dictionary[key], "string", `${key} is localized`);
  }
  assert.match(panel, /translate\(locale, key\)/);
  assert.match(panel, /activityHistory\.viewOnArcScan/);
  assert.match(panel, /activityHistory\.evidenceSummary/);
  assert.match(panel, /activityHistory\.transaction/);
  assert.match(panel, /activityHistory\.network/);
  assert.match(panel, /activityHistory\.time/);
});

test("Phase 7H activity presentation remains display-only and preserves receipt provenance", () => {
  assert.match(panel, /item\.source !== "onchain"/);
  assert.match(panel, /activityHistory\.status\.confirmed/);
  assert.match(panel, /activityHistory\.status\.confirmedLocal/);
  assert.doesNotMatch(panel, /useWriteContract|writeContractAsync|sendTransaction|onRetry/);
});

test("Phase 7H activity dialog contains focus and yields keyboard control to a stacked receipt", () => {
  assert.match(panel, /modalTabStops/);
  assert.match(panel, /modalWrapTarget/);
  assert.match(panel, /event\.key === "Escape"/);
  assert.match(panel, /panel\?\.contains\(document\.activeElement\)/);
  assert.match(panel, /previous\?\.focus\(\)/);
});

test("Phase 7H activity styles are scoped, responsive, and token-led", () => {
  const phaseStyles = css.slice(css.indexOf("/* Phase 7H:"));
  assert.match(phaseStyles, /\.activityHistoryRow \.activityEvidence/);
  assert.match(phaseStyles, /:focus-visible/);
  assert.match(phaseStyles, /@media\(max-width:767px\)/);
  assert.match(phaseStyles, /overflow-wrap:anywhere/);
  assert.doesNotMatch(phaseStyles, /#[\da-f]{3,8}\b|gradient/i);
});

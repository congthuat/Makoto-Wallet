import assert from "node:assert/strict";
import test from "node:test";
import { arcTestnet } from "viem/chains";
import { duplicateRecipientCheck, globalReviewChecks, hasBlockingChecks, quoteFreshnessCheck, reviewStillCurrent, sendRecipientChecks, type ReviewSnapshot } from "./transactionReview.ts";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const account = "0x1111111111111111111111111111111111111111" as const;
const recipient = "0x2222222222222222222222222222222222222222" as const;
const base: ReviewSnapshot = { kind: "send", account, chainId: arcTestnet.id, fields: { asset: "usdc", amount: 10n, recipient } };

test("global checks block disconnected wallet, wrong network, zero and excessive amounts", () => {
  assert.equal(hasBlockingChecks(globalReviewChecks({ connected: false, isArc: false, amount: 0n, balance: 5n })), true);
  assert.equal(hasBlockingChecks(globalReviewChecks({ connected: true, account, isArc: false, amount: 1n, balance: 5n })), true);
  assert.equal(hasBlockingChecks(globalReviewChecks({ connected: true, account, isArc: true, amount: 6n, balance: 5n })), true);
  assert.equal(hasBlockingChecks(globalReviewChecks({ connected: true, account, isArc: true, amount: 5n, balance: 5n })), false);
});

test("account, chain and input mutations invalidate a reviewed snapshot", () => {
  assert.equal(reviewStillCurrent(base, { ...base }), true);
  assert.equal(reviewStillCurrent(base, { ...base, account: recipient }), false);
  assert.equal(reviewStillCurrent(base, { ...base, chainId: 1 }), false);
  assert.equal(reviewStillCurrent(base, { ...base, fields: { ...base.fields, amount: 11n } }), false);
  assert.equal(reviewStillCurrent(base, { ...base, fields: { ...base.fields, recipient: account } }), false);
});

test("send recipient checks validate address, zero address, self-send, unknown recipient and memo", () => {
  assert.equal(hasBlockingChecks(sendRecipientChecks("bad", account)), true);
  assert.equal(hasBlockingChecks(sendRecipientChecks("0x0000000000000000000000000000000000000000", account)), true);
  assert.equal(sendRecipientChecks(account, account).some((check) => check.code === "self" && check.status === "attention"), true);
  assert.equal(sendRecipientChecks(recipient, account).some((check) => check.code === "unknown-recipient" && check.status === "info"), true);
  assert.equal(sendRecipientChecks(recipient, account).some((check) => check.status === "attention"), false);
  assert.equal(sendRecipientChecks(recipient, account, true, true).some((check) => check.label === "Public on-chain memo"), true);
});

test("swap quote freshness blocks expiration and fingerprints quote mutation", () => {
  assert.equal(quoteFreshnessCheck(1_000, 1_500, 1_000).status, "verified");
  assert.equal(quoteFreshnessCheck(1_000, 2_001, 1_000).status, "blocking");
  const swap: ReviewSnapshot = { kind: "swap", account, chainId: arcTestnet.id, fields: { quote: "100", minimum: "99", slippage: "0.5" } };
  assert.equal(reviewStillCurrent(swap, { ...swap, fields: { ...swap.fields, quote: "101" } }), false);
});

test("bridge and savings snapshots include route, destination and selected jar", () => {
  const bridge: ReviewSnapshot = { kind: "bridge", account, chainId: arcTestnet.id, fields: { route: "Arc Testnet>Base Sepolia", destination: account, amount: 5n } };
  const savings: ReviewSnapshot = { kind: "savingsDeposit", account, chainId: arcTestnet.id, fields: { jarId: 3n, mode: "SHIELDED", privacy: "PRIVATE", amount: 5n } };
  assert.equal(reviewStillCurrent(bridge, { ...bridge }), true);
  assert.equal(reviewStillCurrent(savings, { ...savings }), true);
  assert.equal(reviewStillCurrent(savings, { ...savings, fields: { ...savings.fields, jarId: 4n } }), false);
});

test("batch and unified balance reviews invalidate changed totals and reject duplicates", () => {
  const batch: ReviewSnapshot = { kind: "batchPayment", account, chainId: arcTestnet.id, fields: { total: 5n, recipients: `${recipient},${account}` } };
  const unified: ReviewSnapshot = { kind: "unifiedBalanceSpend", account, chainId: arcTestnet.id, fields: { amount: 5n, source: "gateway", destination: recipient } };
  assert.equal(duplicateRecipientCheck([recipient, account]).status, "verified");
  assert.equal(duplicateRecipientCheck([recipient, recipient]).status, "blocking");
  assert.equal(reviewStillCurrent(batch, { ...batch, fields: { ...batch.fields, total: 6n } }), false);
  assert.equal(reviewStillCurrent(unified, { ...unified, fields: { ...unified.fields, destination: account } }), false);
});

test("English and Vietnamese catalogs cover semantic review UI", () => {
  for (const key of ["review.continueWallet", "review.blocking", "review.changed", "review.publicMemo", "review.networkFee"] as const) {
    assert.ok(en[key].length > 0);
    assert.ok(vi[key].length > 0);
    assert.notEqual(en[key], vi[key]);
  }
});

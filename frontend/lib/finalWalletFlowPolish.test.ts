import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name: string) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8");
const send = component("SendFlow.tsx");
const swap = component("RealSwapFlow.tsx");
const bridge = component("UniversalBridgeFlow.tsx");
const review = component("TransactionSafetyReview.tsx");
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("compact reviews show exactly one review title while normal panel titles remain available", () => {
  assert.match(styles, /\.wallet-action-modal:has\(\.compact-transaction-review\)>\.modal-header h2\{display:none\}/);
  assert.match(review, /compact-transaction-review[\s\S]*?<h3>\{title\}<\/h3>/);
  assert.match(send, /title=\{copy\.review\}/);
  assert.match(swap, /"Review Swap"/);
  assert.match(bridge, /"Review Bridge"/);
});

test("compact Send, Swap, and Bridge reviews omit the generic wallet confirmation sentence", () => {
  assert.match(send, /compact[\s\S]*?walletNotice=""/);
  assert.match(swap.slice(swap.indexOf('reviewStage === "swap"')), /compact[\s\S]*?walletNotice=""/);
  assert.match(bridge, /compact[\s\S]*?walletNotice=""/);
  for (const source of [send, swap, bridge]) assert.doesNotMatch(source, /Final confirmation happens in your wallet\./);
  assert.match(review, /continueLabel \?\? t\("review\.continueWallet"\)/);
  assert.match(review, /<details className="compact-review-details">/);
});

test("Send confirmed state keeps one compact recipient presentation", () => {
  const confirmed = send.slice(send.indexOf('stage === "confirmed"'), send.indexOf('stage === "unknown"'));
  assert.match(confirmed, /shortAddress\(validated\.address\)/);
  assert.doesNotMatch(confirmed, /full-address|\{validated\.address\}/);
  assert.match(confirmed, /success-receipt-actions/);
});

test("Swap review uses wallet-language labels in English and Vietnamese", () => {
  const review = swap.slice(swap.indexOf('reviewStage === "swap"'), swap.indexOf('className="create-form wallet-flow compact-swap-flow"'));
  for (const label of ['"You pay"', '"You receive"', '"Minimum received"', '"Fee"', '"Bạn trả"', '"Bạn nhận"', '"Tối thiểu nhận"', '"Phí"']) assert.ok(review.includes(label), label);
  assert.doesNotMatch(review, /"From"|"Current quote"|"Swap network fee"/);
});

test("Bridge default fee is compact while exact components remain in Details", () => {
  assert.match(bridge, /compactBridgeFeeSummary\(estimate\.fees, vi\)/);
  assert.match(bridge, /fraction\.slice\(0, 6\)/);
  assert.match(bridge, /hasGas[\s\S]*?\+ gas/);
  assert.match(bridge, /estimate\.fees\.map\(\(f\) => `\$\{f\.label\}: \$\{f\.amount/);
});

test("Swap and Bridge confirmed states remain compact and repeatable", () => {
  assert.match(swap, /Swap confirmed[\s\S]*?Swap again/);
  assert.match(bridge, /bridge-complete[\s\S]*?Bridge again/);
  assert.doesNotMatch(bridge.slice(bridge.indexOf('className="bridge-complete"'), bridge.indexOf('className="bridge-review"')), /CCTP|protocol|Circle Forwarding Service/);
});

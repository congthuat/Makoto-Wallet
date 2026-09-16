import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { modalWrapTarget } from "./modalFocus.ts";

const panel = {}, close = {}, asset = {}, summary = {}, copy = {};
test("Repair Gate D: closed Details summary wraps Tab to the first control", () => {
  assert.equal(modalWrapTarget([close, asset, summary], summary, false, panel), close);
});
test("Repair Gate D: Shift+Tab wraps to the last visible disclosure control", () => {
  assert.equal(modalWrapTarget([close, asset, summary], close, true, panel), summary);
  assert.equal(modalWrapTarget([close, asset, summary, copy], close, true, panel), copy);
});
test("Repair Gate D: open disclosure preserves normal internal keyboard order", () => {
  assert.equal(modalWrapTarget([close, summary, copy], summary, false, panel), undefined);
  assert.equal(modalWrapTarget([close, summary, copy], summary, true, panel), undefined);
});
test("Repair Gate D: initial panel focus enters the current visible tab sequence", () => {
  assert.equal(modalWrapTarget([close, summary], panel, false, panel), close);
  assert.equal(modalWrapTarget([close, summary], panel, true, panel), summary);
});
test("Repair Gate D: removed or hidden active target returns to visible controls", () => {
  assert.equal(modalWrapTarget([close, summary], copy, false, panel), close);
  assert.equal(modalWrapTarget([close, summary], null, true, panel), summary);
});
test("Repair Gate D: no eligible controls keeps focus on the focusable dialog", () => {
  assert.equal(modalWrapTarget([], close, false, panel), panel);
  assert.equal(modalWrapTarget([], close, true, panel), panel);
});
test("Repair Gate D: Send has a scoped semantic focus rule stronger than legacy suppression", () => {
  const css = readFileSync(new URL("../components/SendReceive.css", import.meta.url), "utf8");
  assert.match(css, /\.ledger-send \.send-flow \.wallet-field-with-action input:focus-visible,[\s\S]*?outline: 3px solid var\(--lc-focus\); outline-offset: 3px/);
  assert.match(css, /input\[aria-invalid="true"\] \{ border-color: var\(--lc-error\)/);
  const tokens = readFileSync(new URL("../app/ledger-calm.css", import.meta.url), "utf8");
  assert.match(tokens, /--lc-focus: var\(--lc-action\)/);
  assert.match(tokens, /--lc-action: light-dark\(/);
});
test("Repair Gate D: keyboard scrolling reserves space for rings and the sticky header", () => {
  const css = readFileSync(new URL("../components/SendReceive.css", import.meta.url), "utf8");
  assert.match(css, /\.wallet-action-modal:has\(\.ledger-send, \.ledger-receive\) \{[^}]*scroll-padding-block: 112px var\(--lc-space-3\)/);
  assert.match(css, /\.ledger-receive :is\(button, input, select, textarea, summary, a\) \{ scroll-margin-block: var\(--lc-space-2\)/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const chart = readFileSync(new URL("../components/BalanceHistoryChart.tsx", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../components/MakotoWallet.module.css", import.meta.url), "utf8");
const sendFlow = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");

test("balance-history All label is localized in English and Vietnamese", () => {
  assert.equal(en["walletHome.historyRangeAll"], "All");
  assert.equal(vi["walletHome.historyRangeAll"], "Tất cả");
  assert.match(chart, /item === "All" \? t\("walletHome\.historyRangeAll"\) : item/);
});

test("chart range buttons preserve native pressed-state behavior", () => {
  assert.match(chart, /aria-pressed=\{range === item\}/);
  assert.match(chart, /onClick=\{\(\) => setRange\(item\)\}/);
});

test("mobile chart range controls expose 44px targets with spacing", () => {
  assert.match(dashboardCss, /\.chartRanges\{min-height:44px;gap:8px\}/);
  assert.match(dashboardCss, /\.chartRanges button\{height:44px;min-width:44px;max-width:none;/);
});

test("Send controls have stable names and explicit label associations", () => {
  for (const [id, name] of [["send-asset", "asset"], ["send-recipient", "recipient"], ["send-amount", "amount"], ["send-note", "note"]]) {
    assert.match(sendFlow, new RegExp(`label htmlFor="${id}"`));
    assert.match(sendFlow, new RegExp(`id="${id}" name="${name}"`));
  }
});

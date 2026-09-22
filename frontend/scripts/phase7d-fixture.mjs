// Test-only renderer of the real Overview and dashboard Agent JSX. Never imported by the app.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const classes = new Proxy({}, { get: (_, key) => String(key) });
function compile(source) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id.endsWith(".css")) return { default: classes };
    if (!id.startsWith(".")) return require(id);
    const resolved = path.resolve(root, "components", id);
    return require(existsSync(resolved + ".ts") ? resolved + ".ts" : path.join(resolved, "index.ts"));
  }, loaded, loaded.exports);
  return loaded.exports;
}
export const { ConnectedOverview } = compile(readFileSync(path.join(root, "components/ConnectedOverview.tsx"), "utf8"));
const { translate } = require(path.join(root, "i18n/index.ts"));
const dashboard = ts.createSourceFile("dashboard.tsx", readFileSync(path.join(root, "components/WalletDashboard.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let children;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(dashboard) === "ConnectedOverview") children = node.children.map(child => child.getFullText(dashboard)).join("");
  ts.forEachChild(node, visit);
}
visit(dashboard);
if (!children) throw new Error("Production Agent children not found");
const { AgentEntry } = compile(`export function AgentEntry({locale,t}) {
  const overviewStyles = ${JSON.stringify(Object.fromEntries(["suggestions", "agentBody", "messages", "composer"].map(key=>[key,key])))}, styles = {}, agentStyles = {};
  const agentMessages=[], agentInput="", agentInputRef=null;
  const agentSuggestions=[{id:"balance",promptKey:"agentDashboard.inputLabel"}];
  const selectAgentSuggestion=()=>{}, submitAgent=(e)=>e.preventDefault(), setAgentInput=()=>{};
  return <>${children}</>;
}`);
export const account = "0x1111111111111111111111111111111111111111";
const { getAssetById } = require(path.join(root, "lib/assets.ts"));
export function record(overrides = {}) {
  return { hash: `0x${"2".repeat(64)}`, logIndex: 1, kind: "transfer", direction: "receive", amount: 1234567n, counterparty: account, confirmedAt: 1789340400000, blockNumber: 1n, assetId: "usdc", assetSymbol: "USDC", tokenAddress: getAssetById("usdc").address, decimals: 6, source: "onchain", ...overrides };
}
export function fixture(overrides = {}) {
  const locale = overrides.locale ?? "en";
  const { balances: balanceOverrides, ...rest } = overrides;
  return { locale, address: account, connectorName: "Test wallet", chainId: 5042002, onArc: true,
    balances: { usdc: { data: 123456789n, isPending: false, isError: false }, eurc: { data: 0n, isPending: false, isError: false }, cirbtc: { data: 0n, isPending: false, isError: false }, ...balanceOverrides },
    activities: [], activityLoading: false, activityPartial: false, activityUnavailable: false,
    onAction: () => {}, onHistory: () => {}, onRefresh: () => {}, onReceipt: () => {},
    children: React.createElement(AgentEntry, { locale, t: key => translate(locale, key) }), ...rest };
}
export function renderOverview(overrides = {}) { return renderToStaticMarkup(React.createElement(ConnectedOverview, fixture(overrides))); }
export function overviewCss() {
  return readFileSync(path.join(root, "app/ledger-calm.css"), "utf8") + "\n" + readFileSync(path.join(root, "components/ConnectedOverview.module.css"), "utf8");
}

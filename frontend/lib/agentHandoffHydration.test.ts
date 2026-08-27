import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canConsumeAgentHandoff, deriveFinancialDataState, deriveWalletUiState } from "./walletHydration.ts";

const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const agent = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");

const connected = { hydrated: true, connectionStatus: "connected" as const, isConnected: true };

test("Agent handoff remains hydrating while wallet reconnection is unresolved", () => {
  assert.equal(deriveWalletUiState({ ...connected, connectionStatus: "reconnecting", connectorChainId: undefined, providerChainId: undefined, isArc: false }), "hydrating");
  assert.match(dashboard, /agentHandoffRequestId && walletState === "disconnected" \? "hydrating"/);
});

test("unknown chain is hydrating and never wrong network", () => {
  assert.equal(deriveWalletUiState({ ...connected, connectorChainId: undefined, providerChainId: undefined, isArc: false }), "hydrating");
  assert.equal(deriveWalletUiState({ ...connected, connectorChainId: 5_042_002, providerChainId: undefined, isArc: false }), "hydrating");
});

test("resolved Arc and actual mismatched chains remain distinct", () => {
  assert.equal(deriveWalletUiState({ ...connected, connectorChainId: 5_042_002, providerChainId: 5_042_002, isArc: true }), "arc");
  assert.equal(deriveWalletUiState({ ...connected, connectorChainId: 84_532, providerChainId: 84_532, isArc: false }), "wrong-network");
});

test("disconnected behavior remains explicit", () => {
  assert.equal(deriveWalletUiState({ hydrated: true, connectionStatus: "disconnected", isConnected: false, isArc: false }), "disconnected");
});

test("loading financial data never masquerades as loaded zero", () => {
  assert.equal(deriveFinancialDataState({ enabled: true, isLoading: true, isError: false }), "loading");
  assert.equal(deriveFinancialDataState({ enabled: true, isLoading: false, isError: false }), "ready");
  assert.equal(deriveFinancialDataState({ enabled: true, isLoading: false, isError: true }), "unavailable");
  assert.match(dashboard, /vaultDataState === "ready" \? formatUsdc\(totals\.totalSaved\) : "—"/);
});

test("prepared handoff waits for Arc balances but survives hydration", () => {
  assert.equal(canConsumeAgentHandoff("hydrating", false), false);
  assert.equal(canConsumeAgentHandoff("arc", false), false);
  assert.equal(canConsumeAgentHandoff("arc", true), true);
  assert.match(dashboard, /canConsumeAgentHandoff\(walletState, balancesSettled\)/);
  assert.match(dashboard, /initialValues=\{agentHandoff \?/);
});

test("actual wrong network remains renderable without pretending balances loaded", () => {
  assert.equal(canConsumeAgentHandoff("wrong-network", false), true);
  assert.match(dashboard, /dashboardState === "hydrating"/);
  assert.match(dashboard, /walletState === "arc"/);
});

test("Agent handoff uses client navigation and never opens a wallet request", () => {
  assert.match(agent, /router\.push\(handoffUrl\(prepared\.handoff!\)\)/);
  assert.doesNotMatch(agent, /window\.location\.assign\(handoffUrl/);
  const prepare = agent.slice(agent.indexOf("function prepare()"), agent.indexOf("if (preparing)"));
  for (const forbidden of ["writeContract", "sendTransaction", "sign", "storeAgentResult", "recordWalletActivity"]) assert.equal(prepare.includes(forbidden), false, forbidden);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { consumeAgentHandoff, storeAgentHandoff } from "./agent/actions/handoff.ts";
import type { AgentActionHandoff } from "./agent/actions/types.ts";
import { canConsumeAgentHandoff, type WalletUiState } from "./walletHydration.ts";

const source = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("WalletDashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const dashboard = parsed.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "WalletDashboard")!;
// Execute the actual query/state declarations and consumer effect, without loading
// wallet providers or transaction components. Hook slots persist across renders.
const statements = dashboard.body!.statements.filter((node) => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some((declaration) =>
    /^(?:searchParams|agentHandoffRequestId|dashboardState|\[action, setAction\]|\[agentHandoff, setAgentHandoff\]|\[agentHandoffRequestId, setAgentHandoffRequestId\])$/.test(declaration.name.getText(parsed)));
  return ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(parsed) === "useEffect" && node.getText(parsed).includes("consumeAgentHandoff(");
});
const script = ts.transpileModule(`(function () {
  ${statements.map((node) => node.getText(parsed)).join("\n")}
  return { action, agentHandoff, agentHandoffRequestId, dashboardState };
})()`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

// Public test fixture reused from agentActions.test.ts; never a connected wallet.
const account = "0x1111111111111111111111111111111111111111";
const now = 2_000;
function handoff(id = "query-regression", action: AgentActionHandoff["action"] = "send"): AgentActionHandoff {
  return { id, path: "/", action, account, createdAt: 1_000, expiresAt: 301_000, amount: "5", asset: "USDC", ...(action === "swap" ? { outputAsset: "EURC" as const } : {}), recipient: account, source: "makoto-agent" };
}

function harness(initialQuery = "") {
  let query = initialQuery, slot = 0, timerId = 0, consumed = 0;
  let dependencies: unknown[] | undefined, cleanup: (() => void) | undefined;
  let pendingEffect: (() => (() => void) | void) | undefined;
  const states: unknown[] = [], timers = new Map<number, () => void>(), values = new Map<string, string>();
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const context = {
    URLSearchParams,
    wallet: { kind: "external", status: "connected", address: account as string | undefined },
    walletState: "arc" as WalletUiState,
    balancesSettled: true,
    canConsumeAgentHandoff,
    consumeAgentHandoff: (...args: Parameters<typeof consumeAgentHandoff>) => {
      consumed++;
      return consumeAgentHandoff(args[0], args[1], args[2], now);
    },
    useSearchParams: () => new URLSearchParams(query),
    useState: (initial?: unknown) => {
      const index = slot++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value: unknown) => { states[index] = value; }];
    },
    useEffect: (effect: () => (() => void) | void, next: unknown[]) => {
      if (!dependencies || next.some((value, index) => !Object.is(value, dependencies![index]))) {
        cleanup?.();
        dependencies = next;
        pendingEffect = effect;
      }
    },
    window: {
      sessionStorage: store,
      location: { pathname: "/", get search() { return query; } },
      history: { replaceState: (_state: unknown, _title: string, url: string) => { query = url.includes("?") ? url.slice(url.indexOf("?")) : ""; } },
      setTimeout: (callback: () => void) => { timers.set(++timerId, callback); return timerId; },
      clearTimeout: (id: number) => { timers.delete(id); },
    },
  };
  function render() {
    slot = 0;
    const result = runInNewContext(script, context) as { action?: string; agentHandoff?: AgentActionHandoff; agentHandoffRequestId?: string; dashboardState: WalletUiState };
    if (pendingEffect) { cleanup = pendingEffect() || undefined; pendingEffect = undefined; }
    return result;
  }
  return {
    context, store, render,
    navigate: (next: string) => { query = next; },
    flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach((callback) => callback()); },
    get consumed() { return consumed; },
    get query() { return query; },
    get stored() { return values.size; },
  };
}

test("same-path query navigation opens the prepared action without remounting", () => {
  const app = harness();
  assert.equal(app.render().action, undefined);
  for (const action of ["send", "swap", "bridge"] as const) {
    const prepared = handoff(`query-${action}`, action);
    storeAgentHandoff(app.store, prepared);
    app.navigate(`?agentHandoff=${prepared.id}`);
    assert.equal(app.render().agentHandoffRequestId, prepared.id);
    app.flush();
    const result = app.render();
    assert.equal(result.action, action);
    assert.deepEqual(result.agentHandoff, prepared);
    assert.equal(result.agentHandoffRequestId, undefined);
    assert.equal(app.query, "");
    assert.equal(app.stored, 0);
  }
  assert.equal(app.consumed, 3);
});

test("initial query survives hydration and pending Arc balances before one-shot consumption", () => {
  const prepared = handoff(), app = harness(`?agentHandoff=${prepared.id}`);
  storeAgentHandoff(app.store, prepared);
  for (const state of ["disconnected", "hydrating", "arc"] as const) {
    app.context.walletState = state;
    app.context.balancesSettled = false;
    app.render(); app.flush();
    assert.equal(app.consumed, 0);
    assert.equal(app.stored, 1);
  }
  app.context.balancesSettled = true;
  app.render(); app.flush();
  assert.equal(app.render().action, "send");
  app.render(); app.flush();
  assert.equal(app.consumed, 1);
});

for (const reason of ["account", "expiry", "id", "missing"] as const) test(`query navigation rejects ${reason} handoffs`, () => {
  const app = harness(), prepared = handoff();
  app.render();
  if (reason !== "missing") storeAgentHandoff(app.store, reason === "expiry" ? { ...prepared, expiresAt: now - 1 } : prepared);
  if (reason === "account") app.context.wallet.address = "0x2222222222222222222222222222222222222222";
  app.navigate(`?agentHandoff=${reason === "id" ? "different-id" : prepared.id}`);
  app.render(); app.flush();
  const result = app.render();
  assert.equal(result.action, undefined);
  assert.equal(result.agentHandoff, undefined);
  assert.equal(result.agentHandoffRequestId, undefined);
  assert.equal(app.stored, 0);
});

test("query removal cancels pending consumption and a consumed URL cannot replay", () => {
  const app = harness(), prepared = handoff();
  app.render();
  storeAgentHandoff(app.store, prepared);
  app.navigate(`?agentHandoff=${prepared.id}`);
  app.render();
  app.navigate("");
  app.render(); app.flush();
  assert.equal(app.consumed, 0);
  assert.equal(app.stored, 1);
  app.navigate(`?agentHandoff=${prepared.id}`);
  app.render(); app.flush();
  const accepted = app.render().agentHandoff;
  assert.equal(accepted?.id, prepared.id);
  app.navigate(`?agentHandoff=${prepared.id}`);
  app.render(); app.flush();
  assert.equal(app.render().agentHandoff, accepted);
  assert.equal(app.stored, 0);
  assert.equal(app.query, "");
});

test("direct wallet entry without a handoff query leaves stored Agent data untouched", () => {
  const app = harness();
  storeAgentHandoff(app.store, handoff());
  app.render(); app.flush();
  assert.equal(app.render().agentHandoff, undefined);
  assert.equal(app.consumed, 0);
  assert.equal(app.stored, 1);
});

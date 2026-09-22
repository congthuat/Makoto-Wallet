/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error Test-only JS renderer transpiles production TSX without a new runner dependency.
import { ConnectedOverview, fixture, renderOverview, record, account } from "../scripts/phase7d-fixture.mjs";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";
import { getAssetById } from "./assets.ts";
import { getAddress, type Hash } from "viem";
import { encodeTransferLog, findUniqueSwapReceive } from "./transactionReceipt.ts";
import { createAssetActivity, deserializeWalletActivity, serializeWalletActivity } from "./walletActivity.ts";

function nodes(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
for (const locale of ["en", "vi"] as const) {
  const copy = locale === "en" ? en : vi;
  test(`7J ${locale}: Overview has one holdings H1, visible Agent composer and wallet/security rail`, () => {
    const html = renderOverview({ locale });
    const positions = ["holdings-title", 'class="actions"', 'id="activity"', "dashboard-agent-title", 'id="assets"'].map(key => html.indexOf(key));
    assert.ok(positions.every(p => p >= 0));
    assert.deepEqual(positions, [...positions].sort((a,b) => a-b));
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.match(html, /<h2 id="dashboard-agent-title"/);
    assert.match(html, /<aside class="rightRail"/);
    assert.match(html, /id="overview-security-title"/);
    assert.doesNotMatch(html, /<details><summary>Prepare an action here/);
    assert.ok(html.includes(copy["overview.holdings"]));
    assert.ok(html.includes(copy["overview.assets"]));
    assert.match(html, /id="dashboard-agent-question"/);
    assert.doesNotMatch(html, /agent-hero|agentOrbit|Protected|Được bảo vệ/);
  });
  test(`7D ${locale}: zero and positive assets remain exact, separate and token-denominated`, () => {
    const html = renderOverview({ locale });
    assert.match(html, />123\.456789 USDC</);
    assert.match(html, />0 EURC</);
    assert.match(html, />0 cirBTC</);
    const assets = nodes(ConnectedOverview(fixture({ locale }))).find(n => n.props?.className === "assets");
    assert.equal(nodes(assets).filter(n => n.type === "li").length, 3, "only supported ERC-20 assets, no native duplicate");
    assert.doesNotMatch(html, /APY|24h|portfolio percentage/i);
    const large = renderOverview({ balances: { usdc: { data: 123456789012345678901234567890n }, eurc: { data: 1n } } });
    assert.match(large, /123456789012345678901234\.56789 USDC/);
    assert.match(large, /0\.000001 EURC/);
    const cirbtc = renderOverview({ balances: { usdc: { data: 1n }, eurc: { data: 1n }, cirbtc: { data: 123456789n } } });
    assert.match(cirbtc, /1\.23456789 cirBTC/);
  });
  test(`7J ${locale}: holdings hero shows asset count and native denomination disclosure without a combined total`, () => {
    const html = renderOverview({ locale });
    assert.ok(html.includes(locale === "en" ? "3 assets" : "3 tài sản"));
    assert.match(html, /123\.456789 USDC/);
    assert.match(html, /0 EURC/);
    assert.ok(html.includes(locale === "en" ? "Balances shown in native denominations." : "Số dư hiển thị theo đơn vị gốc."));
    assert.doesNotMatch(html, /total balance|portfolio value|estimated portfolio|USDC \+ EURC/i);
    const hero = html.slice(html.indexOf('aria-labelledby="holdings-title"'), html.indexOf('class="figures"'));
    assert.doesNotMatch(hero, /123\.456789|0 EURC/);
    assert.doesNotMatch(hero, /<button/);
  });
  test(`7D ${locale}: network/account context and failed/loading balances are not zero`, () => {
    const html = renderOverview({ locale, balances: { usdc: { isPending: true }, eurc: { isError: true, data: 777n } } });
    assert.ok(html.includes(account)); assert.ok(html.includes("5042002"));
    assert.ok(html.includes(`href="https://testnet.arcscan.app/address/${account}"`));
    assert.ok(html.includes(copy["walletHome.loadingBalance"])); assert.ok(html.includes(copy["overview.unavailable"]));
    assert.doesNotMatch(html, /0 EURC|0 USDC|0\.000777/);
    const wrong = renderOverview({ locale, onArc: false, chainId: 1 });
    assert.ok(wrong.includes(copy["overview.wrongNetwork"]));
    assert.ok(wrong.includes(copy["overview.balanceWrongNetwork"]));
    assert.doesNotMatch(wrong, /123\.456789/);
    assert.equal((wrong.match(/disabled=""/g) ?? []).length, 5, "four actions plus collapsed empty composer");
  });
  test(`7D ${locale}: empty, loading, partial and unavailable history have distinct truthful states`, () => {
    assert.ok(renderOverview({ locale }).includes(copy["walletHome.noActivity"]));
    const loading = renderOverview({ locale, activityLoading: true });
    assert.ok(loading.includes(copy["walletHome.activityLoading"]));
    assert.ok(!loading.includes(copy["walletHome.noActivity"]));
    const unavailable = renderOverview({ locale, activityUnavailable: true });
    assert.ok(unavailable.includes(copy["overview.historyUnavailable"]));
    assert.ok(!unavailable.includes(copy["walletHome.noActivity"]));
    const partial = renderOverview({ locale, activityPartial: true, activities: [record({source:"local"})] });
    assert.ok(partial.includes(copy["overview.historyPartial"]));
    assert.ok(partial.includes(copy["overview.locallyObserved"]));
  });
  test(`7D ${locale}: Swap received comes only from swapReceive, never quote/expected/minimum fields`, () => {
    const swap = record({ kind: "swap", direction: "send", outputAmount: 999000000n, expectedAmount: 999000000n, minAmountOut: 998000000n });
    const unknown = renderOverview({locale, activities:[swap]});
    assert.ok(unknown.includes(copy["overview.receivedUnknown"]));
    assert.match(unknown, /−1\.234567 USDC/);
    assert.doesNotMatch(unknown, /999|998|\+.*EURC/);
    const actual = renderOverview({locale, activities:[{...swap, swapReceive:{...getAssetById("eurc"), assetId:"eurc", assetSymbol:"EURC", amount:1100001n, logIndex:2}}]});
    assert.ok(actual.includes(copy["overview.actualReceived"]));
    assert.match(actual, /\+1\.100001 EURC/);
    assert.doesNotMatch(actual, /999|998/);
  });
  test(`7D ${locale}: receipt evidence survives persistence into Overview and ambiguous evidence stays unknown`, () => {
    const wallet = getAddress(account);
    const counterparty = getAddress("0x3333333333333333333333333333333333333333");
    const hash = `0x${"ab".repeat(32)}` as Hash;
    const usdc = getAssetById("usdc")!;
    const eurc = getAssetById("eurc")!;
    const receiveLog = (logIndex: number) => encodeTransferLog({ token: eurc.address, from: counterparty, to: wallet, value: 987654n, logIndex, transactionHash: hash });
    for (const logs of [[receiveLog(2)], [], [receiveLog(2), receiveLog(3)]]) {
      const evidence = findUniqueSwapReceive({ status: "success", transactionHash: hash, blockNumber: 1n, logs }, { token: eurc.address, recipient: wallet, transactionHash: hash });
      const item = createAssetActivity(usdc, {
        hash, logIndex: 1, direction: "send", kind: "swap", amount: 1000000n,
        counterparty, confirmedAt: 1789340400000, blockNumber: 1n,
        ...(evidence ? { swapReceive: { ...evidence, assetId: eurc.id, assetSymbol: eurc.symbol, tokenAddress: eurc.address, decimals: eurc.decimals } } : {}),
      });
      const activities = deserializeWalletActivity(serializeWalletActivity([item]));
      assert.equal(activities.length, 1);
      const html = renderOverview({ locale, activities });
      assert.match(html, /−1 USDC/);
      if (logs.length === 1) {
        assert.ok(html.includes(copy["overview.actualReceived"]));
        assert.match(html, /\+0\.987654 EURC/);
      } else {
        assert.ok(html.includes(copy["overview.receivedUnknown"]));
        assert.doesNotMatch(html, /\+0\.987654 EURC/);
      }
    }
  });
  test(`7D ${locale}: bridge preview states source confirmation without claiming destination completion`, () => {
    const html = renderOverview({ locale, activities: [record({ kind: "bridge", direction: "send", source: "local" })] });
    assert.ok(html.includes(copy["overview.sourceConfirmed"]));
    assert.ok(html.includes(copy["overview.locallyObserved"]));
    assert.doesNotMatch(html, /destination completed|delivered|hoàn tất ở mạng đích/i);
  });
}
test("7D real action props invoke the existing parent callbacks and preserve onArc gating", () => {
  const calls: string[] = [];
  const tree = ConnectedOverview(fixture({onAction:(a:string)=>calls.push(a)}));
  const actions = nodes(tree).find(n => n.props?.className === "actions");
  const buttons = nodes(actions).filter(n => n.type === "button");
  assert.equal(buttons.length,4);
  for (const button of buttons) { assert.equal(button.props.disabled,false); button.props.onClick(); }
  assert.deepEqual(calls,["send","receive","swap","bridge"]);
  const disabled = nodes(ConnectedOverview(fixture({onArc:false}))).find(n=>n.props?.className==="actions");
  assert.ok(nodes(disabled).filter(n=>n.type==="button").every(n=>n.props.disabled));
});
test("7J three-record preview and full history callbacks retain identity", () => {
  const records = Array.from({length:7}, (_, i) => record({logIndex:i, source:i===0?"local":"onchain"}));
  const calls: unknown[] = [];
  const tree = ConnectedOverview(fixture({activities:records,activityUnavailable:true,onHistory:()=>calls.push("history"),onRefresh:()=>calls.push("refresh"),onReceipt:(r:unknown)=>calls.push(r)}));
  const list = nodes(tree).find(n=>n.props?.className==="activity");
  assert.equal(nodes(list).filter(n=>n.type==="li").length,3);
  const buttons = nodes(tree).filter(n=>n.type==="button");
  for (const label of [en["walletHome.viewAll"],en["common.tryAgain"],en["overview.receipt"]]) buttons.find(n=>n.props.children===label).props.onClick();
  assert.deepEqual(calls,["history","refresh",records[0]]);
  assert.equal(nodes(list).filter(n=>n.type==="button").length,1,"onchain-only rows do not acquire receipt actions");
});
test("7J VI holdings heading uses the bundled Vietnamese display font while EN keeps Impact", () => {
  const source = readFileSync(new URL("../components/ConnectedOverview.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../components/ConnectedOverview.module.css", import.meta.url), "utf8");
  assert.match(source, /vietnameseHoldings/);
  assert.match(css, /\.holdings h1 \{[^}]*Impact/);
  assert.match(css, /\.vietnameseHoldings h1 \{[^}]*font-family: var\(--font-vi-display\)/);
  assert.match(css, /\.vietnameseHoldings h1 \{[^}]*font-weight: 900/);
});
test("7J desktop Overview uses explicit holdings, actions, lower-row and asset grid areas", () => {
  const source = readFileSync(new URL("../components/ConnectedOverview.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../components/ConnectedOverview.module.css", import.meta.url), "utf8");
  assert.match(css, /grid-template-columns: repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-areas:[\s\S]*"holdings holdings holdings holdings holdings holdings holdings holdings holdings network network network"/);
  assert.match(css, /"actions actions actions actions actions actions actions actions actions actions actions actions"/);
  assert.match(css, /"activity activity activity activity activity agent agent agent agent security security security"/);
  assert.match(css, /"assets assets assets assets assets assets assets assets assets assets assets assets"/);
  assert.match(css, /\.mainColumn, \.lowerGrid, \.rightRail \{ display: contents; \}/);
  assert.match(css, /\.networkCard \{ grid-area: network; align-self: stretch; height: auto; padding: 14px 16px; \}/);
  assert.match(css, /\.ledger \{ grid-area: activity; align-self: stretch; height: auto; \}/);
  assert.match(css, /\.agent \{ grid-area: agent; align-self: stretch; height: auto; \}/);
  assert.match(css, /\.securityCard \{ grid-area: security; align-self: stretch; height: auto; \}/);
  assert.match(css, /\.assetDisclosure \{ grid-area: assets; align-self: start; \}/);
  assert.match(css, /--dashboard-gap: 14px/);
  assert.doesNotMatch(css, /subgrid/);
  assert.ok(source.indexOf('id="assets"') < source.indexOf('className={styles.rightRail}'));
});
test("7J responsive styles wrap full values and preserve focus inside the light and dark application shell", () => {
  const css=readFileSync(new URL("../components/ConnectedOverview.module.css",import.meta.url),"utf8");
  assert.match(css,/overflow-wrap: anywhere/); assert.match(css,/min-width: 0/);
  assert.match(css,/font-variant-numeric: tabular-nums/); assert.match(css,/:focus-visible/);
  assert.match(css,/min-height: 44px/); assert.match(css,/@media \(max-width: 767px\)/);
  const shell=readFileSync(new URL("../components/AppShell.module.css",import.meta.url),"utf8");
  assert.match(shell,/--mk-shell: var\(--mk-page-bg\)/);
  assert.match(shell,/--mk-shell-line: var\(--mk-border-primary\)/);
  assert.doesNotMatch(css,/animation:|white-space: nowrap/);
});

test("7J every Overview CSS reference resolves, including the recovered rail and asset disclosure", () => {
  const source=readFileSync(new URL("../components/ConnectedOverview.tsx",import.meta.url),"utf8");
  const css=readFileSync(new URL("../components/ConnectedOverview.module.css",import.meta.url),"utf8");
  for (const [,name] of source.matchAll(/styles\.(\w+)/g)) assert.ok(css.includes(`.${name}`), `Missing Overview style: ${name}`);
});

test("7J App Lock reports actual availability and enabled state without a security score", () => {
  for (const [appLock, expected] of [
    [{ initialized: false }, "Checking"],
    [{ initialized: true, available: false }, en["overview.unavailable"]],
    [{ initialized: true, available: true, enabled: false }, "Not enabled"],
    [{ initialized: true, available: true, enabled: true }, "Enabled"],
  ] as const) {
    const html=renderOverview({appLock});
    assert.ok(html.includes(expected));
    assert.doesNotMatch(html,/security score|100% secure/i);
  }
});

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBrowserHarness } from './browser-harness.mjs'

// Actual production SwapPage/BridgePage, controls, strategy state machine and
// Activity merge helpers. Wallet context, quote/policy/simulation, submission,
// receipt and Circle/Base reads are explicitly MOCKED for deterministic UI QA.
// No extension, signer, real wallet request or broadcast is used.
// MAKOTO_COMPLETION_BASELINE_REF=<full production SHA> supplies historical
// controls + parent with read-only git show: terminal completion tests must FAIL.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const account = '0x1111111111111111111111111111111111111111'
const target = '0x2222222222222222222222222222222222222222'
const swapHash = `0x${'a'.repeat(64)}`
const sourceHash = `0x${'b'.repeat(64)}`
const destinationHash = `0x${'c'.repeat(64)}`
const previousHash = `0x${'d'.repeat(64)}`
let browser

const walletFixture = `
  import { createContext, useContext, useState } from 'react';
  import { TOKENS, ARC } from '/src/lib/wallet.ts';
  import { mergeSwapRecord, mergeBridgeRecord } from '/src/lib/protocolActivity.ts';
  const Context = createContext(null);
  export const useWallet = () => useContext(Context);
  export function WalletFixture({ children }) {
    const h = window.__completionHarness;
    const [draft, setSwapDraft] = useState(null);
    const [setters] = useState(() => {
      const upsert = (kind, merge, record) => {
        const records = h[kind];
        const previous = records.find((r) => r.hash === record.hash);
        h[kind] = [merge(previous, record), ...records.filter((r) => r.hash !== record.hash)];
        localStorage.setItem('mk.' + kind + '.records.v1', JSON.stringify(h[kind]));
      };
      return {
        upsertSwap: (record) => upsert('swap', mergeSwapRecord, record),
        upsertBridge: (record) => upsert('bridge', mergeBridgeRecord, record),
        refetchWallet: async () => { h.refreshes++; },
        setSwapDraft, mask: (value) => value, notify: () => {},
      };
    });
    const wallet = {
      mode: 'connected', address: '${account}', walletChainId: ARC.chainId,
      holdings: TOKENS.map((t) => ({...t, symbol: t.sym, verified: true, balance: 10, price: 1})),
      prices: {USDC: {price: 1}, EURC: {price: 1}, BTC: {price: 1}},
      network: {tokenTransferFeeUsdc: 0.002}, swapDraft: draft, ...setters,
    };
    return <Context.Provider value={wallet}>{children}</Context.Provider>;
  }
`

const toolFixture = `
  const h = () => window.__completionHarness;
  const ok = (data) => ({status: 'OK', data});
  const expiry = () => Date.now() + 60_000;
  const action = (kind, q) => ({
    kind, account: '${account}', chainId: 5042002, expiresAt: expiry(),
    request: {from: '${account}', to: '${target}', data: '0x1234', value: '0x0', gas: '0x186a0', gasPrice: '0x1'},
    gasEstimate: {maximumFee: 100000n}, cctp: {finalityThreshold: 1000n},
  });
  export async function readWallet() { h().reads++; return ok({account: '${account}', chainId: 5042002}); }
  export async function readBalance() { h().reads++; return ok({units: 10000000n}); }
  export async function readAllowance() { h().reads++; return ok({units: h().needsApproval && !h().approved ? 0n : 10000000n}); }
  export async function readGasBalance() { h().reads++; return ok(10000000000000000000n); }
  export async function quoteSwap(_, input) {
    h().quotes.push({kind: 'swap', ...input});
    const units = BigInt(input.amount) * 1000000n;
    return ok({expiresAt: expiry(), quote: {amountIn: units, amountOut: units}, minimumReceive: units - 1000n, balance: 10000000n, allowance: 10000000n});
  }
  export async function prepareSwap(_, q) { return action('swap', q); }
  export async function prepareApproval() { throw new Error('Unexpected MOCK approval path'); }
  export async function quoteBridge(_, input) {
    h().quotes.push({kind: 'bridge', ...input});
    const amount = BigInt(input.amount) * 1000000n;
    return ok({amount, expectedReceive: amount - 1000n, maxFee: 1000n, totalDebit: amount, transferSpeed: input.transferSpeed,
      spender: '${target}', recipient: '${account}', destinationDomain: 6, expiresAt: expiry()});
  }
  export async function prepareCctpBurn(_, q) { return action('cctp-burn', q); }
  export async function prepareCctpApproval(_, q) { return {...action('approval', q), cctp: {approvalAmount: q.totalDebit}}; }
`

const policyFixture = `
  export function evaluateToolPolicy() { return {mustStop: false, findings: []}; }
  export function createReview(action, quote, policy) { return {action, quote, policy, expiresAt: Date.now() + 60_000}; }
  export function revalidateReview() { return {status: 'OK'}; }
  export function verifyFiniteApproval() { throw new Error('Unexpected MOCK approval path'); }
`

const protocolFixture = `
  const h = () => window.__completionHarness;
  export const isWalletRejection = (error) => error?.code === 4001;
  async function submit(kind) {
    h().walletRequests.push(kind);
    if (h().outcome === 'rejected') throw Object.assign(new Error('MOCK user rejected'), {code: 4001});
    return kind === 'swap' ? '${swapHash}' : '${sourceHash}';
  }
  export const requestReviewedAction = async () => submit('swap');
  export const requestReviewedCctpAction = async () => submit('bridge');
  export async function pollProtocolReceipt(_, action, hash, evidence, onPending) {
    h().receipts.push(hash);
    onPending();
    if (h().holdReceipt) await new Promise((resolve) => { h().releaseReceipt = resolve; });
    if (action.kind === 'approval') h().approved = true;
    return h().outcome === 'failed' ? 'failed' : 'confirmed';
  }
  export async function checkProtocolReceipt() { h().reads++; return 'confirmed'; }
`

const circleFixture = `
  export const simulatePreparedCctpCall = async () => ({success: true});
  export const sameCctpActionMaterial = () => true;
  export const sameCctpQuoteMaterial = () => true;
  export const cctpGasEstimateChanged = () => false;
  export async function getOfficialCctpStatus() {
    const h = window.__completionHarness;
    h.statusReads++;
    return ['destination-pending', 'destination-confirmed'].includes(h.circleState)
      ? {state: 'forwarding-pending', forwardTxHash: '${destinationHash}'}
      : {state: h.circleState};
  }
`

const entry = `
  import { createElement, StrictMode, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { WalletFixture } from '/__completion_test__/wallet.jsx';
  const q = new URLSearchParams(location.search);
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('mk.lang', q.get('lang') || 'en');
  const previous = {hash: '${previousHash}', account: '${account}', target: '${target}', calldata: '0x1234',
    fromSymbol: 'USDC', toSymbol: 'EURC', minimumOutputUnits: '8999000', timestamp: 1,
    status: 'completed', amount: '9', expectedReceiveUnits: '8999000', destinationDomain: 6, maxFeeUnits: '1000', finalityThreshold: '1000'};
  const h = window.__completionHarness = {
    ready: false, calls: [], quotes: [], walletRequests: [], receipts: [], reads: 0, statusReads: 0, refreshes: 0,
    outcome: q.get('outcome') || 'confirmed', holdReceipt: q.get('hold') === '1',
    needsApproval: q.get('approval') === '1', approved: false,
    circleState: q.get('circle') || 'destination-confirmed',
    swap: [previous], bridge: [{...previous, status: 'destination-confirmed', destinationHash: '${previousHash}'}],
  };
  localStorage.setItem('mk.swap.records.v1', JSON.stringify(h.swap));
  localStorage.setItem('mk.bridge.records.v1', JSON.stringify(h.bridge));
  window.ethereum = {isMetaMask: true, request: async ({method}) => {
    h.calls.push(method);
    if (method === 'eth_call') return '0x';
    if (method === 'eth_gasPrice') return '0x1';
    throw new Error('Unexpected provider request in MOCKED completion QA: ' + method);
  }};
  window.fetch = async (url) => {
    if (!String(url).includes('/cctp/destination?')) throw new Error('Unexpected fetch in MOCKED completion QA: ' + url);
    h.destinationReads = (h.destinationReads || 0) + 1;
    return {ok: true, json: async () => ({status: h.circleState === 'destination-confirmed' ? 'confirmed' : 'pending'})};
  };
  const pages = await import('/src/pages/SwapBridge.tsx');
  const Component = pages[q.get('kind') === 'bridge' ? 'BridgePage' : 'SwapPage'];
  function Remountable() {
    const [epoch, setEpoch] = useState(0);
    h.remount = () => setEpoch((n) => n + 1);
    return createElement(Component, {key: epoch});
  }
  createRoot(document.getElementById('app')).render(createElement(StrictMode, null, createElement(WalletFixture, null, createElement(Remountable))));
  h.ready = true;
`

before(async () => {
  const baselineRef = process.env.MAKOTO_COMPLETION_BASELINE_REF
  if (baselineRef) assert.match(baselineRef, /^[0-9a-f]{40}$/i, 'Negative control requires a full production commit SHA')
  const historical = new Map()
  if (baselineRef) for (const file of ['pages/SwapBridge.tsx', 'components/LiveSwapControl.tsx', 'components/LiveCctpControl.tsx']) {
    historical.set(`/src/${file}`, execFileSync('git', ['show', `${baselineRef}:frontend/src/${file}`], {cwd: frontendRoot, encoding: 'utf8'}))
  }
  browser = createBrowserHarness({ frontendRoot, name: 'completion', ready: 'window.__completionHarness?.ready && document.querySelector("input")', plugins: [{
    name: 'mocked-protocol-completion-fixture', enforce: 'pre',
    resolveId(source, importer = '') {
      if (/\/lib\/store(?:\.tsx)?$/.test(source)) return '/__completion_test__/wallet.jsx'
      if (source.startsWith('/__completion_test__/')) return source
      const control = /\/components\/Live(?:Swap|Cctp)Control\.tsx$/.test(importer.replaceAll('\\', '/'))
      if (control && source.endsWith('/toolLayer.ts')) return '/__completion_test__/tools.js'
      if (control && source.endsWith('/policy.ts')) return '/__completion_test__/policy.js'
      if ((control || importer.replaceAll('\\', '/').endsWith('/migrated/strategyController.ts')) && source.endsWith('/protocolExecution.ts')) return '/__completion_test__/protocol.js'
      if (control && source.endsWith('/cctpAdapter.ts')) return '/__completion_test__/circle.js'
    },
    load(id) {
      for (const [suffix, source] of historical) if (id.replaceAll('\\', '/').endsWith(suffix)) return source
      return ({'/__completion_test__/wallet.jsx': walletFixture, '/__completion_test__/tools.js': toolFixture,
        '/__completion_test__/policy.js': policyFixture, '/__completion_test__/protocol.js': protocolFixture,
        '/__completion_test__/circle.js': circleFixture, '/__completion_test__/entry.js': entry})[id]
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__completion_test__?')) return next()
        const html = await vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="app"></div><script type="module" src="/__completion_test__/entry.js"></script></body></html>')
        res.setHeader('Content-Type', 'text/html'); res.end(html)
      })
    },
  }] })
  await browser.start()
})

after(async () => { await browser?.close() })
const fixture = (params, run) => browser.fixture('__completion_test__', params, run)
const buttons = (label) => `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === ${JSON.stringify(label)})`
const exists = (label) => `${buttons(label)}.length > 0`
const enabled = (label) => `${buttons(label)}.some((b) => !b.disabled)`
const h = 'window.__completionHarness'
const amount = 'document.querySelector("input").value'
const transactionLinks = `document.querySelectorAll('a[href*="/tx/"]').length`
const labels = (kind, lang = 'en') => lang === 'vi'
  ? {start: kind === 'swap' ? 'Lấy báo giá trực tiếp và xem lại' : 'Lấy báo giá Circle và xem lại', confirm: kind === 'swap' ? 'Xác nhận hoán đổi trong ví' : 'Xem lệnh đốt CCTP', done: 'Hoàn tất', check: 'Kiểm tra biên nhận Arc, trạng thái Circle và đích Base'}
  : {start: kind === 'swap' ? 'Get live quote and review' : 'Get live Circle quote and review', confirm: kind === 'swap' ? 'Confirm swap in wallet' : 'Review CCTP burn', done: 'Done', check: 'Check Arc receipt, Circle status and Base destination'}

async function submit(ui, kind, lang) {
  const names = labels(kind, lang)
  await ui.fill(0, '1')
  await ui.wait(enabled(names.start), 'A valid amount enables explicit quote preparation')
  await ui.click(names.start)
  await ui.wait(enabled(names.confirm), 'Actual control must prepare its wallet review')
  assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [], 'Quote/review must never request the wallet automatically')
  await ui.click(names.confirm)
  return names
}

for (const kind of ['swap', 'bridge']) for (const lang of ['en', 'vi']) {
  test(`MOCKED actual ${kind} ${lang}: completion preserves evidence; Done resets parent and UI without wallet/quote calls or Activity loss`, async () => {
    await fixture({kind, lang}, async (ui) => {
      const names = await submit(ui, kind, lang)
      if (kind === 'bridge') {
        await ui.wait(enabled(names.check), 'Arc source confirmation must keep destination checks available')
        assert.equal(await ui.evaluate(amount), '1', 'Arc source confirmation must not reset Bridge amount')
        assert.equal(await ui.evaluate(exists(names.done)), false, 'Arc source alone is not completion')
        await ui.click(names.check)
      }
      await ui.wait(`document.body.innerText.includes('${kind === 'swap' ? swapHash : destinationHash}') && (${enabled(names.done)} || ${enabled(names.start)})`, 'Terminal evidence must remain visible with an acknowledgment action')
      assert.equal(await ui.evaluate(exists(names.start)), false, 'Completed transaction must not show a new-quote button')
      await ui.wait(enabled(names.done), 'Verified terminal completion must expose localized Done')
      assert.equal(await ui.evaluate(amount), '1', 'Amount/evidence must remain until acknowledgment')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind], 'Only explicit confirm requests the MOCK wallet')
      const text = await ui.evaluate('document.body.innerText')
      assert.ok(text.includes(kind === 'swap' ? swapHash : sourceHash), 'Confirmed source evidence remains visible')
      if (kind === 'bridge') assert.ok(text.includes(destinationHash), 'Base destination hash remains visible until Done')
      const record = await ui.evaluate(`${h}.${kind}.find((r) => r.hash === '${kind === 'swap' ? swapHash : sourceHash}')`)
      assert.equal(record.status, kind === 'swap' ? 'completed' : 'destination-confirmed')
      if (kind === 'bridge') assert.equal(record.destinationHash, destinationHash)
      const retained = await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`)
      const before = await ui.evaluate(`JSON.stringify({calls: ${h}.calls, quotes: ${h}.quotes, walletRequests: ${h}.walletRequests, reads: ${h}.reads, statusReads: ${h}.statusReads, refreshes: ${h}.refreshes})`)
      await ui.click(names.done)
      await ui.wait(`${amount} === '' && ${exists(names.start)}`, 'Done must reset the actual parent amount and return to idle')
      assert.equal(await ui.evaluate(enabled(names.start)), false, 'Fresh form requires a new amount')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(transactionLinks), 0, 'Acknowledgment clears all local hashes')
      const clean = await ui.evaluate('document.body.innerText')
      assert.doesNotMatch(clean, /Live output|Quote expires|Gross USDC amount|Estimated Arc gas ceiling|Swap confirmed with|Destination confirmed by|Nhận dự kiến|Số USDC chuyển|Phí gas Arc ước tính/)
      if (kind === 'bridge') assert.match(clean, lang === 'vi' ? /Lấy báo giá trực tiếp bên dưới/ : /Get a live quote below/, 'Parent Circle quote must also clear')
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), retained, 'Completed and older Activity records remain byte-for-byte unchanged')
      assert.equal(await ui.evaluate(`JSON.stringify({calls: ${h}.calls, quotes: ${h}.quotes, walletRequests: ${h}.walletRequests, reads: ${h}.reads, statusReads: ${h}.statusReads, refreshes: ${h}.refreshes})`), before, 'Done/reset must make no provider, wallet, quote or status request')
      const checkpoint = await ui.evaluate(`JSON.parse(localStorage.getItem('mk.strategy.v1:${kind === 'swap' ? 'swap' : 'cctp'}:${account}'))`)
      assert.equal(checkpoint.phase, 'IDLE'); assert.equal(checkpoint.hash, undefined); assert.equal(checkpoint.binding, undefined)
      await ui.evaluate(`${h}.remount()`)
      await ui.wait(`${amount} === '' && ${exists(names.start)}`, 'Remount must retain a clean checkpoint rather than resurrect completed evidence')
      assert.equal(await ui.evaluate(transactionLinks), 0)
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), retained)
      await ui.fill(0, '2')
      await ui.wait(enabled(names.start), 'Entering another amount restores normal form')
      assert.equal(await ui.evaluate(`${h}.quotes.length`), JSON.parse(before).quotes.length, 'New amount must not automatically start another quote')
      await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'Only an explicit start obtains a fresh review')
      assert.equal(await ui.evaluate(`${h}.quotes.at(-1).amount`), '2')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind], 'Fresh quote does not automatically open the wallet')
    })
  })
}

test('MOCKED CCTP source-pending then source-confirmed retains amount/hash/progress and never offers Done or another quote', async () => {
  await fixture({kind: 'bridge', hold: '1'}, async (ui) => {
    const names = await submit(ui, 'bridge')
    await ui.wait(`!!${h}.releaseReceipt`, 'Source receipt must be pending')
    assert.equal(await ui.evaluate(amount), '1')
    assert.equal(await ui.evaluate(exists(names.done)), false)
    assert.equal(await ui.evaluate(exists(names.start)), false)
    assert.match(await ui.evaluate('document.body.innerText'), /Awaiting Arc receipt/)
    await ui.evaluate(`${h}.releaseReceipt()`)
    await ui.wait(enabled(names.check), 'Source confirmation must allow read-only destination checks')
    assert.match(await ui.evaluate('document.body.innerText'), /Arc source confirmed.*still pending/)
    assert.ok((await ui.evaluate('document.body.innerText')).includes(sourceHash))
    assert.equal(await ui.evaluate(amount), '1')
    assert.equal(await ui.evaluate(exists(names.done)), false)
    assert.equal(await ui.evaluate(exists(names.start)), false)
    assert.equal(await ui.evaluate(`${h}.bridge.find((r) => r.hash === '${sourceHash}').status`), 'source-confirmed')
  })
})

test('MOCKED CCTP approval-confirmed preserves explicit fresh burn review continuation without completing or resetting the amount', async () => {
  await fixture({kind: 'bridge', approval: '1'}, async (ui) => {
    const names = labels('bridge')
    await ui.fill(0, '1')
    await ui.wait(enabled(names.start), 'Amount enables quote preparation')
    await ui.click(names.start)
    await ui.wait(enabled('Review exact approval'), 'Insufficient allowance must offer a separate approval review')
    assert.equal(await ui.evaluate(exists(names.done)), false)
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    await ui.click('Review exact approval')
    await ui.wait(enabled(names.start), 'Confirmed approval must retain the existing fresh quote continuation')
    assert.match(await ui.evaluate('document.body.innerText'), /Approval confirmed.*review the burn separately/)
    assert.equal(await ui.evaluate(amount), '1')
    assert.equal(await ui.evaluate(exists(names.done)), false, 'An approval receipt is not bridge completion')
    assert.equal(await ui.evaluate(`JSON.parse(localStorage.getItem('mk.strategy.v1:cctp:${account}')).phase`), 'REVALIDATING')
    assert.equal(await ui.evaluate(`${h}.bridge.length`), 1, 'Approval must not create a completed bridge Activity record')
    assert.equal(await ui.evaluate(`${h}.quotes.length`), 1, 'Approval completion must not automatically prepare the burn')
    await ui.click(names.start)
    await ui.wait(enabled(names.confirm), 'Explicit refresh must re-read allowance and offer a separate burn review')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'], 'Burn preparation must not automatically request another wallet transaction')
    assert.equal(await ui.evaluate(amount), '1')
    assert.equal(await ui.evaluate(exists(names.done)), false)
  })
})

for (const state of ['attestation-pending', 'attestation-available', 'forwarding-pending', 'destination-pending']) {
  test(`MOCKED CCTP ${state} retains progress and amount until verified destination confirmation`, async () => {
    await fixture({kind: 'bridge', circle: state}, async (ui) => {
      const names = await submit(ui, 'bridge')
      await ui.wait(enabled(names.check), 'Source receipt must confirm first')
      await ui.click(names.check)
      await ui.wait(`${h}.statusReads === 1 && ${enabled(names.check)}`, 'Circle status check must settle')
      const expected = {'attestation-pending': /Circle attestation is pending/, 'attestation-available': /Circle attestation is available/, 'forwarding-pending': /Circle forwarding is pending/, 'destination-pending': /Waiting for verified Base receipt/}[state]
      assert.match(await ui.evaluate('document.body.innerText'), expected)
      assert.equal(await ui.evaluate(amount), '1')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.ok((await ui.evaluate('document.body.innerText')).includes(sourceHash))
      if (state === 'destination-pending') assert.ok((await ui.evaluate('document.body.innerText')).includes(destinationHash))
      assert.equal(await ui.evaluate(`${h}.bridge.find((r) => r.hash === '${sourceHash}').status`), state === 'destination-pending' ? 'destination-pending' : 'attesting')
      assert.equal(await ui.evaluate(`JSON.parse(localStorage.getItem('mk.strategy.v1:cctp:${account}')).phase`), state === 'destination-pending' ? 'DESTINATION_PENDING' : 'SOURCE_CONFIRMED')
      await ui.evaluate(`${h}.circleState = 'destination-confirmed'`)
      await ui.click(names.check)
      await ui.wait(enabled(names.done), 'Completion must appear only after confirmed Base result')
      assert.equal(await ui.evaluate(amount), '1')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'], 'Read-only progress checks never request a second wallet transaction')
    })
  })
}

for (const kind of ['swap', 'bridge']) for (const outcome of ['failed', 'rejected']) {
  test(`MOCKED ${kind} ${outcome}: existing explicit retry remains and completion reset is unavailable`, async () => {
    await fixture({kind, outcome}, async (ui) => {
      const names = await submit(ui, kind)
      await ui.wait(enabled(names.start), 'Existing failed/rejected retry must remain available')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(amount), '1')
      assert.match(await ui.evaluate('document.body.innerText'), outcome === 'failed' ? /failed on Arc|Arc source transaction failed/ : /Wallet request rejected/)
      assert.equal(await ui.evaluate(`${h}.quotes.length`), kind === 'swap' ? 2 : 1, 'Failure/rejection must not automatically retry')
      if (outcome === 'rejected') assert.equal(await ui.evaluate(transactionLinks), 0)
    })
  })
}

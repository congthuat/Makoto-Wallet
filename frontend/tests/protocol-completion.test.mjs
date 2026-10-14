import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
const otherAccount = '0x3333333333333333333333333333333333333333'
const otherSourceHash = `0x${'e'.repeat(64)}`
const realCircleResponse = JSON.parse(readFileSync(new URL('./fixtures/cctp-v2-completed-arc-base-sepolia.json', import.meta.url), 'utf8'))
const realCircleMessage = realCircleResponse.messages[0]
const realBurnHash = '0x452e3fcc7a2112e4940b19e23e065cf62dadcd20ffb53d620361ab57d605dba4'
const realForwardHash = realCircleMessage.forwardTxHash
const realBody = realCircleMessage.decodedMessage.decodedMessageBody
const realAccount = realBody.mintRecipient
const realReceiveUnits = '945701'
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
    const [who, setWho] = useState(h.activeAccount);
    const [chain, setChain] = useState(h.activeChain);
    h.changeAccount = (next) => { h.activeAccount = next; setWho(next); };
    h.changeChain = (next) => { h.activeChain = next; setChain(next); };
    const [setters] = useState(() => {
      const upsert = (kind, merge, record) => {
        h.activityWrites.push({kind, record});
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
      mode: 'connected', address: who, walletChainId: chain,
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
    kind, account: h().activeAccount, chainId: 5042002, expiresAt: expiry(),
    request: {from: h().activeAccount, to: '${target}', data: '0x1234', value: '0x0', gas: '0x186a0', gasPrice: '0x1'},
    gasEstimate: {maximumFee: 100000n}, cctp: {finalityThreshold: 1000n},
  });
  export async function readWallet() { h().reads++; return ok({account: h().activeAccount, chainId: h().activeChain}); }
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
    await h().gate('Quote');
    if (h().quoteUnavailable) return {status: 'UNAVAILABLE', reason: 'MOCK raw English Circle error'};
    const amount = BigInt(input.amount) * 1000000n;
    return ok({amount, expectedReceive: amount - 1000n, maxFee: 1000n, totalDebit: amount, transferSpeed: input.transferSpeed,
      spender: '${target}', recipient: input.account, destinationDomain: 6, expiresAt: expiry()});
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
    await h().gate('Receipt');
    if (action.kind === 'approval') h().approved = true;
    return h().outcome === 'failed' ? 'failed' : 'confirmed';
  }
  export async function checkProtocolReceipt(_, action, hash) {
    h().reads++; h().recoveries.push({account: action.account, hash});
    await h().gate('Recovery');
    if (h().recoveryError) throw new Error('MOCK recovery unavailable');
    return 'confirmed';
  }
`

const circleFixture = `
  import { getOfficialCctpStatus as readActualCircleStatus } from '/src/protocols/circle/cctpAdapter.ts';
  export const simulatePreparedCctpCall = async () => { await window.__completionHarness.gate('Simulation'); return {success: true}; };
  export const sameCctpActionMaterial = () => true;
  export const sameCctpQuoteMaterial = () => true;
  export const cctpGasEstimateChanged = () => false;
  export async function getOfficialCctpStatus(provider, input) {
    const h = window.__completionHarness;
    h.statusReads++;
    h.statusInputs.push(input);
    const state = h.circleState;
    await h.gate('Status');
    if (h.statusError) throw new Error('MOCK Circle unavailable');
    if (h.realShape) return readActualCircleStatus(provider, input);
    return ['destination-pending', 'destination-confirmed'].includes(state)
      ? {state: 'forwarding-pending', forwardTxHash: '${destinationHash}'}
      : {state};
  }
`

const entry = `
  import { createElement, StrictMode, useState } from 'react';
  import { createRoot } from 'react-dom/client';
  import { WalletFixture, useWallet } from '/__completion_test__/wallet.jsx';
  const q = new URLSearchParams(location.search);
  const realShape = q.get('realShape') === '1';
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('mk.lang', q.get('lang') || 'en');
  const previous = {hash: '${previousHash}', account: '${account}', target: '${target}', calldata: '0x1234',
    fromSymbol: 'USDC', toSymbol: 'EURC', minimumOutputUnits: '8999000', timestamp: 1,
    status: 'completed', amount: '9', expectedReceiveUnits: '8999000', destinationDomain: 6, maxFeeUnits: '1000', finalityThreshold: '1000'};
  const h = window.__completionHarness = {
    ready: false, calls: [], quotes: [], walletRequests: [], receipts: [], reads: 0, statusReads: 0, refreshes: 0,
    activeAccount: realShape ? '${realAccount}' : '${account}', activeChain: 5042002, recoveries: [], statusInputs: [], activityWrites: [], storageWrites: [],
    completeCallbacks: 0, sourceCallbacks: 0, quoteCallbacks: 0, consoleErrors: [], destinationReads: 0,
    holds: new Set(q.get('gate') ? [q.get('gate')] : []), releases: {}, settled: {},
    outcome: q.get('outcome') || 'confirmed', holdReceipt: q.get('hold') === '1',
    needsApproval: q.get('approval') === '1', approved: false,
    circleState: q.get('circle') || 'destination-confirmed',
    realShape, circleHttpReads: [], destinationInputs: [],
    quoteUnavailable: q.get('quoteUnavailable') === '1', destinationState: q.get('destination'),
    swap: [previous], bridge: [{...previous, status: 'destination-confirmed', destinationHash: '${previousHash}'}],
  };
  h.gate = async (name) => {
    if (!h.holds.has(name)) return;
    await new Promise((resolve) => { h.releases[name] = resolve; });
    h.settled[name] = (h.settled[name] || 0) + 1;
  };
  h.release = (name) => { h.holds.delete(name); h.releases[name](); };
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && key.startsWith('mk.strategy.') && h.failStrategySave) throw new Error('MOCK checkpoint storage failure');
    if (this === localStorage && (key.startsWith('mk.strategy.') || key === 'mk.bridge.records.v1')) h.storageWrites.push({key, value});
    return originalSetItem.call(this, key, value);
  };
  const originalError = console.error;
  console.error = (...args) => { h.consoleErrors.push(args.map(String).join(' ')); originalError(...args); };
  h.seedRun = (who, hash, extra = {}) => {
    const value = {version: 1, protocol: 'cctp', account: who, chainId: 5042002, phase: 'SOURCE_CONFIRMED', step: 'cctp-burn', hash, updatedAt: 1,
      binding: {from: who, to: '${target}', data: '0x1234', amount: '1', expectedReceiveUnits: '999000', recipient: who,
        destinationDomain: 6, maxFeeUnits: '1000', finalityThreshold: '1000'}, ...extra};
    localStorage.setItem('mk.strategy.v1:cctp:' + who, JSON.stringify(value));
    return value;
  };
  if (q.get('lifecycle') === '1' && q.get('seed') !== '0') {
    if (realShape) h.seedRun('${realAccount}', '${realBurnHash}', {
      binding: {from: '${realAccount}', to: '${realBody.messageSender}', data: '0x1234', amount: '1',
        expectedReceiveUnits: '${realReceiveUnits}', recipient: '${realAccount}', destinationDomain: 6,
        maxFeeUnits: '${realBody.maxFee}', finalityThreshold: '${realCircleMessage.decodedMessage.minFinalityThreshold}'},
    });
    else { h.seedRun('${account}', '${sourceHash}'); h.seedRun('${otherAccount}', '${otherSourceHash}'); }
  }
  localStorage.setItem('mk.swap.records.v1', JSON.stringify(h.swap));
  localStorage.setItem('mk.bridge.records.v1', JSON.stringify(h.bridge));
  window.ethereum = {isMetaMask: true, request: async ({method}) => {
    h.calls.push(method);
    if (method === 'eth_call') return '0x';
    if (method === 'eth_gasPrice') return '0x1';
    throw new Error('Unexpected provider request in MOCKED completion QA: ' + method);
  }};
  window.fetch = async (url) => {
    if (h.realShape && String(url).startsWith('https://iris-api-sandbox.circle.com/v2/messages/26?transactionHash=')) {
      h.circleHttpReads.push(String(url));
      if (new URL(String(url)).searchParams.get('transactionHash') !== '${realBurnHash}') throw new Error('Wrong captured Circle burn hash');
      return Response.json(${JSON.stringify(realCircleResponse)});
    }
    if (!String(url).includes('/cctp/destination?')) throw new Error('Unexpected fetch in MOCKED completion QA: ' + url);
    h.destinationReads = (h.destinationReads || 0) + 1;
    h.destinationInputs.push(String(url));
    const state = h.destinationState || (h.circleState === 'destination-confirmed' ? 'confirmed' : 'pending');
    await h.gate('Destination');
    return {ok: h.destinationState !== 'http-error', json: async () => { await h.gate('DestinationBody'); return {status: state}; }};
  };
  const pages = await import('/src/pages/SwapBridge.tsx');
  const Component = pages[q.get('kind') === 'bridge' ? 'BridgePage' : 'SwapPage'];
  const { LiveCctpControl } = await import('/src/components/LiveCctpControl.tsx');
  function LifecyclePage() {
    const wallet = useWallet();
    const [value, setValue] = useState('1');
    return createElement('div', null,
      createElement('input', {value, onChange: (event) => setValue(event.target.value)}),
      createElement(LiveCctpControl, {account: wallet.address, amount: value, transferSpeed: 'FAST',
        onSourceConfirmed: async () => { h.sourceCallbacks++; await h.gate('SourceCallback'); }, onComplete: () => { h.completeCallbacks++; setValue(''); },
        onQuoteChange: () => { h.quoteCallbacks++; }}));
  }
  function Remountable() {
    const [epoch, setEpoch] = useState(0);
    h.remount = () => setEpoch((n) => n + 1);
    return createElement(q.get('lifecycle') === '1' ? LifecyclePage : Component, {key: epoch});
  }
  const root = createRoot(document.getElementById('app'));
  h.unmount = () => root.unmount();
  root.render(createElement(StrictMode, null, createElement(WalletFixture, null, createElement(Remountable))));
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

test('MOCKED Vietnamese CCTP review unavailable text is localized before any wallet request', async () => {
  await fixture({kind: 'bridge', lang: 'vi', quoteUnavailable: '1'}, async (ui) => {
    const names = labels('bridge', 'vi')
    await ui.fill(0, '1')
    await ui.click(names.start)
    await ui.wait(`document.body.innerText.includes('Không thể lấy trạng thái CCTP lúc này. Hãy kiểm tra lại sau.')`, 'Unknown CCTP review error must use the Vietnamese fallback')
    assert.doesNotMatch(await ui.evaluate('document.body.innerText'), /CCTP review or status unavailable\.|MOCK raw English Circle error/)
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  })
})

for (const lang of ['en', 'vi']) {
  test(`MOCKED CCTP ${lang} unavailable retry and refresh preserve source hash without duplicate submission`, async () => {
    await fixture({kind: 'bridge', lang, circle: 'unavailable'}, async (ui) => {
      const names = await submit(ui, 'bridge', lang)
      await ui.wait(enabled(names.check), 'Source must confirm first')
      await ui.click(names.check)
      await ui.wait(`${h}.statusReads === 1 && ${enabled(names.check)}`, 'Unavailable Circle read must allow a safe check again')
      const safe = lang === 'vi'
        ? 'Không thể lấy trạng thái Circle lúc này. Không gửi lại giao dịch; hãy kiểm tra trạng thái đã lưu.'
        : 'Circle status is unavailable. Do not resubmit the transfer; check its saved status.'
      assert.ok((await ui.evaluate('document.body.innerText')).includes(safe))
      assert.ok((await ui.evaluate('document.body.innerText')).includes(sourceHash))
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(`JSON.parse(localStorage.getItem('mk.strategy.v1:cctp:${account}')).phase`), 'SOURCE_CONFIRMED')
      await ui.click(names.check)
      await ui.wait(`${h}.statusReads === 2 && ${enabled(names.check)}`, 'Repeated unavailable reads must remain read-only')
      await ui.evaluate(`${h}.remount()`)
      await ui.wait(enabled(names.check), 'Refresh must restore the source-confirmed transfer')
      assert.ok((await ui.evaluate('document.body.innerText')).includes(sourceHash))
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      await ui.click(names.check)
      await ui.wait(`${h}.statusReads === 3 && ${enabled(names.check)}`, 'Restored transfer must support read-only retry')
      assert.ok((await ui.evaluate('document.body.innerText')).includes(safe))
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'])
      assert.equal(await ui.evaluate(`${h}.quotes.length`), 1)
      assert.equal(await ui.evaluate(`${h}.bridge.find((r) => r.hash === '${sourceHash}').status`), 'source-confirmed')
    })
  })
}

for (const destination of ['pending', 'unknown', 'unavailable', 'http-error']) {
  test(`MOCKED CCTP retry cannot complete from a forward hash with ${destination} Base evidence`, async () => {
    const lang = destination === 'unavailable' ? 'vi' : 'en'
    await fixture({kind: 'bridge', lang, circle: 'destination-confirmed', destination}, async (ui) => {
      const names = await submit(ui, 'bridge', lang)
      await ui.wait(enabled(names.check), 'Arc source alone must not complete')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      await ui.click(names.check)
      await ui.wait(`${h}.destinationReads === 1 && ${enabled(names.check)}`, 'Forward hash requires a Base receipt read')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.ok((await ui.evaluate('document.body.innerText')).includes(sourceHash))
      assert.ok((await ui.evaluate('document.body.innerText')).includes(destinationHash))
      assert.equal(await ui.evaluate(`JSON.parse(localStorage.getItem('mk.strategy.v1:cctp:${account}')).phase`), destination === 'pending' ? 'DESTINATION_PENDING' : 'SOURCE_CONFIRMED')
      if (destination !== 'pending') assert.match(await ui.evaluate('document.body.innerText'), lang === 'vi' ? /Không gửi lại giao dịch; hãy kiểm tra trạng thái đã lưu/ : /Do not resubmit the transfer; check its saved status/)
      await ui.click(names.check)
      await ui.wait(`${h}.destinationReads === 2 && ${enabled(names.check)}`, 'Repeated destination checks must preserve the observed hash')
      await ui.evaluate(`${h}.remount(); ${h}.circleState = 'unavailable'`)
      await ui.wait(enabled(names.check), 'Saved source progress must survive refresh')
      await ui.click(names.check)
      await ui.wait(`${h}.statusReads === 3 && ${enabled(names.check)}`, 'Unavailable status after refresh must remain read-only')
      assert.equal(await ui.evaluate(`${h}.bridge.find((r) => r.hash === '${sourceHash}').destinationHash`), destinationHash)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      await ui.evaluate(`${h}.circleState = 'destination-confirmed'`)
      await ui.evaluate(`${h}.destinationState = 'confirmed'`)
      await ui.click(names.check)
      await ui.wait(enabled(names.done), 'Only confirmed Base receipt evidence may complete the transfer')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'])
      assert.equal(await ui.evaluate(`${h}.quotes.length`), 1)
    })
  })
}

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

const checkpoint = (who) => `localStorage.getItem('mk.strategy.v1:cctp:${who}')`
const lifecycleSnapshot = `JSON.stringify({a: ${checkpoint(account)}, b: ${checkpoint(otherAccount)},
  activity: ${h}.bridge, activityWrites: ${h}.activityWrites.length, storageWrites: ${h}.storageWrites.length,
  sourceCallbacks: ${h}.sourceCallbacks, completeCallbacks: ${h}.completeCallbacks, quoteCallbacks: ${h}.quoteCallbacks})`
async function settleGate(ui, gate) {
  await ui.evaluate(`${h}.release('${gate}')`)
  await ui.wait(`${h}.settled.${gate} >= 1`, 'The delayed MOCK response must settle')
  // Drain the async continuation and React commits before checking absence of writes.
  await ui.evaluate('new Promise((resolve) => setTimeout(resolve, 50))')
}
async function startSavedCheck(ui, gate) {
  const names = labels('bridge')
  await ui.wait(enabled(names.check), 'A saved confirmed burn must restore a read-only check')
  await ui.click(names.check)
  await ui.wait(`!!${h}.releases.${gate}`, `${gate} response must be delayed`)
  return names
}

for (const gate of ['Recovery', 'Status', 'Destination', 'DestinationBody']) {
  test(`MOCKED CCTP lifecycle: account switch discards delayed ${gate} evidence and preserves B exactly`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', gate}, async (ui) => {
      const names = await startSavedCheck(ui, gate)
      await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
      await ui.wait(`document.body.innerText.includes('${otherSourceHash}') && ${enabled(names.check)}`, 'B must restore its own source hash and release the old lock')
      const before = await ui.evaluate(lifecycleSnapshot)
      await settleGate(ui, gate)
      assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'A late evidence must perform no strategy, Activity or callback mutation')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.ok((await ui.evaluate('document.body.innerText')).includes(otherSourceHash))
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
      assert.equal(await ui.evaluate(`${h}.quotes.length`), 0)
      // The new account must be able to check independently after discarding A.
      await ui.click(names.check)
      await ui.wait(enabled(names.done), 'B can complete only from a new explicitly requested B evidence check')
      assert.equal(await ui.evaluate(`JSON.parse(${checkpoint(otherAccount)}).phase`), 'COMPLETED')
      assert.equal(await ui.evaluate(`${h}.statusInputs.at(-1).account`), otherAccount)
      assert.equal(await ui.evaluate(`${h}.statusInputs.at(-1).burnHash`), otherSourceHash)
      assert.equal(await ui.evaluate(`${h}.activityWrites.filter((w) => w.record.status === 'destination-confirmed').length`), 1)
    })
  })
}

for (const gate of ['Status', 'Destination', 'DestinationBody']) {
  test(`MOCKED CCTP lifecycle: unmount makes delayed ${gate} response harmless`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', gate}, async (ui) => {
      await startSavedCheck(ui, gate)
      await ui.evaluate(`${h}.unmount()`)
      const before = await ui.evaluate(lifecycleSnapshot)
      await settleGate(ui, gate)
      assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'Unmounted work cannot write Activity, checkpoint, callbacks or completion')
      assert.equal(await ui.evaluate('document.querySelectorAll("button").length'), 0)
      assert.deepEqual(await ui.evaluate(`${h}.consoleErrors`), [], 'No late React mutation warning')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    })
  })
}

test('MOCKED CCTP lifecycle: ten synchronous checks run one recovery/Circle/Base sequence with no submission or duplicate completion', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', gate: 'Status'}, async (ui) => {
    const names = labels('bridge')
    await ui.wait(enabled(names.check), 'Saved source transfer must be checkable')
    await ui.evaluate(`(() => { const button = ${buttons(names.check)}[0]; for (let i = 0; i < 10; i++) button.click(); })()`)
    await ui.wait(`!!${h}.releases.Status`, 'The single Circle operation must be held')
    assert.equal(await ui.evaluate(`${h}.recoveries.length`), 1, 'The synchronous mutex must precede the first async recovery read')
    assert.equal(await ui.evaluate(`${h}.statusReads`), 1)
    assert.equal(await ui.evaluate(`${h}.destinationReads`), 0)
    await settleGate(ui, 'Status')
    await ui.wait(enabled(names.done), 'One verified Base result may complete once')
    assert.equal(await ui.evaluate(`${h}.recoveries.length`), 1)
    assert.equal(await ui.evaluate(`${h}.statusReads`), 1)
    assert.equal(await ui.evaluate(`${h}.destinationReads`), 1)
    assert.equal(await ui.evaluate(`${h}.activityWrites.filter((w) => w.record.status === 'destination-confirmed').length`), 1)
    assert.equal(await ui.evaluate(`${h}.storageWrites.filter((w) => w.key.startsWith('mk.strategy.') && JSON.parse(w.value).phase === 'COMPLETED').length`), 1)
    assert.equal(await ui.evaluate(`${h}.completeCallbacks`), 0, 'Completion acknowledgment requires its own explicit Done click')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    assert.deepEqual(await ui.evaluate(`${h}.receipts`), [])
    assert.deepEqual(await ui.evaluate(`${h}.quotes`), [])
  })
})

for (const lang of ['en', 'vi']) {
  test(`CAPTURED Circle COMPLETE ${lang}: saved real-shape burn reconciles once through actual adapter and the independent Base gate before explicit Done`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', realShape: '1', lang, gate: 'DestinationBody'}, async (ui) => {
      const names = labels('bridge', lang)
      await ui.wait(enabled(names.check), 'The isolated saved SOURCE_CONFIRMED transfer must restore Check Again')
      const saved = await ui.evaluate(`JSON.parse(${checkpoint(realAccount)})`)
      assert.equal(saved.phase, 'SOURCE_CONFIRMED')
      assert.equal(saved.hash, realBurnHash)
      assert.equal(saved.binding.recipient, realAccount)
      assert.equal(saved.binding.expectedReceiveUnits, realReceiveUnits)
      assert.equal(await ui.evaluate(exists(names.start)), false, 'The saved transfer must block a new Bridge')
      await ui.evaluate(`(() => { const button = ${buttons(names.check)}[0]; for (let i = 0; i < 10; i++) button.click(); })()`)
      await ui.wait(`!!${h}.releases.DestinationBody`, 'The actual Circle adapter must expose the recovered hash for independent Base verification')
      assert.equal(await ui.evaluate(`${h}.recoveries.length`), 1)
      assert.equal(await ui.evaluate(`${h}.statusReads`), 1)
      assert.equal(await ui.evaluate(`${h}.circleHttpReads.length`), 1, 'The real SDK must consume the captured HTTP response')
      const statusInput = JSON.parse(await ui.evaluate(`JSON.stringify(${h}.statusInputs[0], (_, value) => typeof value === 'bigint' ? value.toString() : value)`))
      assert.equal(statusInput.account, realAccount)
      assert.equal(statusInput.burnHash, realBurnHash)
      assert.equal(statusInput.recipient, realAccount)
      assert.equal(statusInput.expectedReceive, realReceiveUnits)
      assert.equal(statusInput.maxFee, realBody.maxFee)
      assert.equal(statusInput.finalityThreshold, realCircleMessage.decodedMessage.minFinalityThreshold)
      const destinationInput = new URL(await ui.evaluate(`${h}.destinationInputs[0]`), 'http://fixture.invalid')
      assert.equal(destinationInput.searchParams.get('txHash'), realForwardHash)
      assert.equal(destinationInput.searchParams.get('recipient'), realAccount)
      assert.equal(destinationInput.searchParams.get('minimumUnits'), realReceiveUnits)
      assert.ok((await ui.evaluate('document.body.innerText')).includes(realForwardHash))
      assert.equal(await ui.evaluate(`JSON.parse(${checkpoint(realAccount)}).phase`), 'SOURCE_CONFIRMED', 'Circle COMPLETE and forward hash cannot complete before Base evidence')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(`${h}.activityWrites.filter((w) => w.record.status === 'destination-confirmed').length`), 0)
      await settleGate(ui, 'DestinationBody')
      await ui.wait(enabled(names.done), 'Only the independent Base confirmation may expose localized Done')
      assert.equal(await ui.evaluate(`JSON.parse(${checkpoint(realAccount)}).phase`), 'COMPLETED')
      assert.equal(await ui.evaluate(`${h}.destinationReads`), 1)
      assert.equal(await ui.evaluate(`${h}.activityWrites.filter((w) => w.record.status === 'destination-confirmed').length`), 1)
      assert.equal(await ui.evaluate(`${h}.storageWrites.filter((w) => w.key.startsWith('mk.strategy.') && JSON.parse(w.value).phase === 'COMPLETED').length`), 1)
      assert.equal(await ui.evaluate(`${h}.completeCallbacks`), 0, 'The completed checkpoint remains until explicit acknowledgment')
      assert.equal(await ui.evaluate(amount), '1')
      const record = await ui.evaluate(`${h}.bridge.find((r) => r.hash === '${realBurnHash}')`)
      assert.equal(record.status, 'destination-confirmed')
      assert.equal(record.destinationHash, realForwardHash)
      assert.equal(record.expectedReceiveUnits, realReceiveUnits)
      const activity = await ui.evaluate(`localStorage.getItem('mk.bridge.records.v1')`)
      const reads = await ui.evaluate(`JSON.stringify({recovery: ${h}.recoveries, circle: ${h}.circleHttpReads, destination: ${h}.destinationReads})`)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [], 'Recovery must never request a new approval or burn')
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [], 'Recovery must never poll a newly submitted transaction')
      assert.deepEqual(await ui.evaluate(`${h}.quotes`), [], 'Recovery must use the exact saved review rather than prepare a new burn')
      assert.equal(await ui.evaluate(`${h}.calls.some((method) => ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_requestAccounts', 'personal_sign', 'eth_sign'].includes(method))`), false)
      await ui.click(names.done)
      await ui.wait(`${amount} === '' && ${exists(names.start)}`, 'Explicit isolated-fixture Done may acknowledge the transfer and return to IDLE')
      assert.equal(await ui.evaluate(`JSON.parse(${checkpoint(realAccount)}).phase`), 'IDLE')
      assert.equal(await ui.evaluate(`${h}.completeCallbacks`), 1)
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.bridge.records.v1')`), activity, 'Done preserves the single Activity completion')
      assert.equal(await ui.evaluate(`JSON.stringify({recovery: ${h}.recoveries, circle: ${h}.circleHttpReads, destination: ${h}.destinationReads})`), reads, 'Acknowledgment must perform no additional protocol work')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
      assert.deepEqual(await ui.evaluate(`${h}.quotes`), [])
    })
  })
}

for (const replacement of ['hash', 'binding']) {
  test(`MOCKED CCTP lifecycle: replacing same-account saved ${replacement} discards prior evidence`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', gate: 'Status'}, async (ui) => {
      const names = await startSavedCheck(ui, 'Status')
      await ui.evaluate(replacement === 'hash'
        ? `${h}.seedRun('${account}', '${otherSourceHash}')`
        : `(() => { const saved = JSON.parse(${checkpoint(account)}); saved.binding.expectedReceiveUnits = '1999000'; localStorage.setItem('mk.strategy.v1:cctp:${account}', JSON.stringify(saved)); })()`)
      const before = await ui.evaluate(lifecycleSnapshot)
      await settleGate(ui, 'Status')
      assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'Changed immutable transfer identity rejects old completion')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(`${h}.destinationReads`), 0)
      await ui.evaluate(`${h}.remount()`)
      await ui.wait(enabled(names.check), 'A fresh mount releases prior work and restores the replacement run')
      await ui.click(names.check)
      await ui.wait(enabled(names.done), 'Replacement requires its own fresh verification')
      assert.equal(await ui.evaluate(`${h}.statusInputs.length`), 2)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    })
  })
}

test('MOCKED CCTP lifecycle: A to B to A invalidates the original A generation', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', gate: 'Status'}, async (ui) => {
    const names = await startSavedCheck(ui, 'Status')
    await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
    await ui.wait(`document.body.innerText.includes('${otherSourceHash}')`, 'B must mount its identity')
    await ui.evaluate(`${h}.changeAccount('${account}')`)
    await ui.wait(`document.body.innerText.includes('${sourceHash}') && ${enabled(names.check)}`, 'A is a new lifecycle generation')
    const before = await ui.evaluate(lifecycleSnapshot)
    await settleGate(ui, 'Status')
    assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'Returning to A cannot resurrect its invalidated operation')
    assert.equal(await ui.evaluate(exists(names.done)), false)
    await ui.click(names.check)
    await ui.wait(enabled(names.done), 'A new check may verify A after the old generation settles')
  })
})

test('MOCKED CCTP lifecycle: changing chain discards delayed destination evidence and unlocks after returning to Arc', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', gate: 'DestinationBody'}, async (ui) => {
    const names = await startSavedCheck(ui, 'DestinationBody')
    await ui.evaluate(`${h}.changeChain(84532)`)
    await ui.evaluate('new Promise((resolve) => setTimeout(resolve, 50))')
    const before = await ui.evaluate(lifecycleSnapshot)
    await settleGate(ui, 'DestinationBody')
    assert.equal(await ui.evaluate(lifecycleSnapshot), before)
    assert.equal(await ui.evaluate(exists(names.done)), false)
    await ui.evaluate(`${h}.changeChain(5042002)`)
    await ui.wait(enabled(names.check), 'Returning to Arc must release the invalidated lock')
    await ui.click(names.check)
    await ui.wait(enabled(names.done), 'Only a new Arc-context operation can complete')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  })
})

for (const failure of ['error', 'unavailable']) {
  test(`MOCKED CCTP lifecycle: ${failure} releases check mutex for a safe retry`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', circle: failure === 'unavailable' ? 'unavailable' : 'destination-confirmed'}, async (ui) => {
      const names = labels('bridge')
      if (failure === 'error') await ui.evaluate(`${h}.statusError = true`)
      await ui.wait(enabled(names.check), 'Saved transfer must restore')
      await ui.click(names.check)
      await ui.wait(`${h}.statusReads === 1 && ${enabled(names.check)}`, 'Failure must always release the immediate mutex')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      await ui.evaluate(`${h}.statusError = false; ${h}.circleState = 'destination-confirmed'`)
      await ui.click(names.check)
      await ui.wait(enabled(names.done), 'Explicit retry remains available after failure')
      assert.equal(await ui.evaluate(`${h}.recoveries.length`), 2)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    })
  })
}

for (const gate of ['Quote', 'Simulation']) {
  test(`MOCKED CCTP lifecycle: delayed preparation ${gate} cannot publish review after account change`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', seed: '0', gate}, async (ui) => {
      const names = labels('bridge')
      await ui.wait(enabled(names.start), 'Fresh account can explicitly prepare')
      await ui.click(names.start)
      await ui.wait(`!!${h}.releases.${gate}`, 'Preparation must wait at the chosen boundary')
      await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
      await ui.wait(enabled(names.start), 'New account must have fresh idle controls')
      const before = await ui.evaluate(lifecycleSnapshot)
      await settleGate(ui, gate)
      assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'Stale preparation cannot save a review or publish a quote')
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    })
  })
}

for (const gate of ['Simulation', 'Receipt']) {
  test(`MOCKED CCTP lifecycle: delayed confirm ${gate} cannot mutate after unmount`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', seed: '0'}, async (ui) => {
      const names = labels('bridge')
      await ui.wait(enabled(names.start), 'A fresh transfer can be reviewed')
      await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'Separate explicit burn review must appear')
      await ui.evaluate(`${h}.holds.add('${gate}')`)
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releases.${gate}`, 'Confirm must wait at the chosen boundary')
      await ui.evaluate(`${h}.unmount()`)
      const before = await ui.evaluate(lifecycleSnapshot)
      await settleGate(ui, gate)
      assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'Late confirm work cannot write checkpoint, Activity or callbacks')
      assert.equal(await ui.evaluate(`${h}.walletRequests.length`), gate === 'Receipt' ? 1 : 0)
      assert.equal(await ui.evaluate(`${h}.sourceCallbacks`), 0)
      assert.deepEqual(await ui.evaluate(`${h}.consoleErrors`), [])
    })
  })
}

for (const change of ['account', 'amount']) {
  test(`MOCKED CCTP lifecycle: ${change} change during confirmation simulation prevents the stale wallet request`, async () => {
    await fixture({kind: 'bridge', lifecycle: '1', seed: '0'}, async (ui) => {
      const names = labels('bridge')
      await ui.wait(enabled(names.start), 'A fresh transfer must be explicitly reviewed')
      await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'Initial burn review must be ready')
      await ui.evaluate(`${h}.holds.add('Simulation')`)
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releases.Simulation`, 'Confirmation simulation must be held before wallet request')
      if (change === 'account') await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
      else await ui.fill(0, '2')
      await ui.wait(enabled(names.start), 'Changed input must clear the old executable review and lock')
      const before = await ui.evaluate(lifecycleSnapshot)
      await settleGate(ui, 'Simulation')
      assert.equal(await ui.evaluate(lifecycleSnapshot), before)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [], 'An invalidated review must never ask any wallet to sign')
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
    })
  })
}

test('MOCKED CCTP lifecycle: stale A finally cannot release B check lock while B response is pending', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', gate: 'Status'}, async (ui) => {
    const names = await startSavedCheck(ui, 'Status')
    await ui.evaluate(`${h}.releaseA = ${h}.releases.Status; ${h}.changeAccount('${otherAccount}')`)
    await ui.wait(`document.body.innerText.includes('${otherSourceHash}') && ${enabled(names.check)}`, 'B starts with an independent unlocked context')
    await ui.click(names.check)
    await ui.wait(`${h}.statusReads === 2 && ${h}.releases.Status !== ${h}.releaseA`, 'B must hold its own new operation')
    const before = await ui.evaluate(lifecycleSnapshot)
    await ui.evaluate(`(async () => { ${h}.releaseA(); await new Promise((resolve) => setTimeout(resolve, 50)); })()`)
    assert.equal(await ui.evaluate(lifecycleSnapshot), before)
    assert.equal(await ui.evaluate(enabled(names.check)), false, 'A finally must not clear B busy UI or mutex')
    assert.equal(await ui.evaluate(`${h}.destinationReads`), 0)
    await settleGate(ui, 'Status')
    await ui.wait(enabled(names.done), 'B finishes only after its own response is released')
    assert.equal(await ui.evaluate(`${h}.recoveries.length`), 2)
    assert.equal(await ui.evaluate(`${h}.statusReads`), 2)
    assert.equal(await ui.evaluate(`${h}.destinationReads`), 1)
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  })
})

test('MOCKED CCTP lifecycle: a terminal saved checkpoint with the same hash cannot be overwritten by an old check', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', gate: 'Status'}, async (ui) => {
    const names = await startSavedCheck(ui, 'Status')
    await ui.evaluate(`(() => { const saved = JSON.parse(${checkpoint(account)}); saved.phase = 'COMPLETED'; localStorage.setItem('mk.strategy.v1:cctp:${account}', JSON.stringify(saved)); })()`)
    const before = await ui.evaluate(lifecycleSnapshot)
    await settleGate(ui, 'Status')
    assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'The exact checkpoint revision, beyond hash identity, binds each evidence operation')
    assert.equal(await ui.evaluate(exists(names.done)), false, 'An externally written phase cannot fabricate verified completion in this control')
    assert.equal(await ui.evaluate(`${h}.destinationReads`), 0)
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  })
})

test('MOCKED CCTP lifecycle: unmount during source callback discards its continuation before Activity and Circle reads', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', gate: 'SourceCallback'}, async (ui) => {
    await startSavedCheck(ui, 'SourceCallback')
    assert.equal(await ui.evaluate(`${h}.sourceCallbacks`), 1, 'The callback began while the operation was mounted and current')
    await ui.evaluate(`${h}.unmount()`)
    const before = await ui.evaluate(lifecycleSnapshot)
    await settleGate(ui, 'SourceCallback')
    assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'A callback already in flight must not enable late Activity or state updates')
    assert.equal(await ui.evaluate(`${h}.statusReads`), 0)
    assert.equal(await ui.evaluate(`${h}.destinationReads`), 0)
    assert.equal(await ui.evaluate(`${h}.activityWrites.length`), 0)
    assert.deepEqual(await ui.evaluate(`${h}.consoleErrors`), [])
  })
})

test('MOCKED CCTP lifecycle: failed strategy save preserves the run and releases the read-only check lock', async () => {
  await fixture({kind: 'bridge', lifecycle: '1'}, async (ui) => {
    const names = labels('bridge')
    await ui.wait(enabled(names.check), 'Saved transfer must be available')
    const before = await ui.evaluate(lifecycleSnapshot)
    await ui.evaluate(`${h}.failStrategySave = true`)
    await ui.click(names.check)
    await ui.wait(`${h}.recoveries.length === 1 && ${enabled(names.check)}`, 'Storage failure must release the immediate lock')
    assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'A failed checkpoint write cannot advance any in-memory run, Activity or callback')
    assert.equal(await ui.evaluate(exists(names.done)), false)
    assert.equal(await ui.evaluate(`${h}.statusReads`), 0)
    await ui.evaluate(`${h}.failStrategySave = false`)
    await ui.click(names.check)
    await ui.wait(enabled(names.done), 'An explicit retry after storage recovery may complete')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  })
})

test('MOCKED CCTP lifecycle: Cancel cannot erase a replacement saved transfer from an old review', async () => {
  await fixture({kind: 'bridge', lifecycle: '1', seed: '0'}, async (ui) => {
    const names = labels('bridge')
    await ui.wait(enabled(names.start), 'A fresh quote must be explicit')
    await ui.click(names.start)
    await ui.wait(enabled(names.confirm), 'A bounded burn review must appear')
    await ui.evaluate(`${h}.seedRun('${account}', '${otherSourceHash}')`)
    const before = await ui.evaluate(lifecycleSnapshot)
    await ui.click('Cancel')
    assert.equal(await ui.evaluate(lifecycleSnapshot), before, 'Old review cancel cannot reset a newer saved run to IDLE')
    await ui.click(names.confirm)
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [], 'Old review cannot request the wallet after checkpoint replacement')
    await ui.evaluate(`${h}.remount()`)
    await ui.wait(`document.body.innerText.includes('${otherSourceHash}') && ${enabled(names.check)}`, 'The replacement transfer remains recoverable')
  })
})

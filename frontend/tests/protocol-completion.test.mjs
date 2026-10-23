import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBrowserHarness } from './browser-harness.mjs'

// Arc RPC mock — handles all bypass methods (eth_call, eth_gasPrice,
// eth_getCode, eth_estimateGas, eth_getBalance, eth_getTransactionReceipt,
// eth_getTransactionByHash, eth_blockNumber). Called server-side by the
// Vite middleware at /__completion_arc_rpc__; browser sets
// window.__arcRpcOverrideUrl so arcRpc.ts routes fetch() there instead of
// rpc.testnet.arc.io. This prevents SIMULATION_REVERTED from a live Arc call
// and prevents HTTP 429 rate-limit failures.
function handleCompletionArcRpc(method, _params) {
  // [result, error] — error is a JSON-RPC error object or null
  if (method === 'eth_call') {
    // Simulate all calls as successful (return empty 32-byte word).
    // simulate() in LiveSwapControl treats any non-throw as success.
    return ['0x' + '0'.repeat(64), null]
  }
  if (method === 'eth_gasPrice') {
    // Must be <= prepared.request.gasPrice (which comes from toolFixture gasPrice='1').
    // Return 1 wei so the gasPrice freshness check passes.
    return ['0x1', null]
  }
  if (method === 'eth_getCode') {
    // All token/contract addresses return non-empty code.
    return ['0x6000', null]
  }
  if (method === 'eth_estimateGas') return ['0x186a0', null]
  if (method === 'eth_getBalance') return ['0x' + (100n * 10n ** 18n).toString(16), null]
  if (method === 'eth_getTransactionReceipt') return [null, null]
  if (method === 'eth_getTransactionByHash') return [null, null]
  if (method === 'eth_blockNumber') return ['0x7b', null]
  if (method === 'eth_chainId') return ['0x4cef52', null]
  return [null, { code: -32601, message: `Unexpected Arc RPC mock method: ${method}` }]
}

// Actual production SwapPage/BridgePage, controls, strategy state machine,
// policy/finite-approval validation, CCTP gas/material and Activity merge helpers.
// Wallet context, quote/prepare/simulation, submission, receipt and Circle/Base
// reads are explicitly MOCKED for deterministic UI QA.
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
const approvalHash = `0x${'f'.repeat(64)}`
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
    const [, setActivityRevision] = useState(0);
    h.changeAccount = (next) => { h.activeAccount = next; setWho(next); };
    h.changeChain = (next) => { h.activeChain = next; setChain(next); };
    const [setters] = useState(() => {
      const upsert = (kind, merge, record) => {
        let checkpoint;
        try { checkpoint = localStorage.getItem('mk.strategy.v1:' + (kind === 'swap' ? 'swap' : 'cctp') + ':' + record.account.toLowerCase()); }
        catch { checkpoint = 'READ_UNAVAILABLE'; }
        h.activityWrites.push({kind, record, checkpoint});
        if (h.failActivity) throw new Error('MOCK Activity persistence unavailable');
        const records = Array.isArray(h[kind]) ? h[kind] : [];
        const previous = records.find((r) => r.hash === record.hash);
        h[kind] = [merge(previous, record), ...records.filter((r) => r.hash !== record.hash)];
        if (!h.silentActivityFailure) localStorage.setItem('mk.' + kind + '.records.v1', JSON.stringify(h[kind]));
        setActivityRevision((revision) => revision + 1);
      };
      return {
        upsertSwap: (record) => upsert('swap', mergeSwapRecord, record),
        upsertBridge: (record) => upsert('bridge', mergeBridgeRecord, record),
        refetchWallet: async () => { h.refreshes++; await h.gate('SourceCallback'); if (h.callbackError) throw new Error('MOCK wallet refresh unavailable'); },
        setSwapDraft, mask: (value) => value, notify: () => {},
      };
    });
    const wallet = {
      mode: 'connected', address: who, walletChainId: chain,
      get swapRecords() { return h.swap; }, get bridgeRecords() { return h.bridge; },
      holdings: TOKENS.map((t) => ({...t, symbol: t.sym, verified: true, balance: 10, price: 1})),
      prices: {USDC: {price: 1}, EURC: {price: 1}, BTC: {price: 1}},
      network: {tokenTransferFeeUsdc: 0.002}, swapDraft: draft, ...setters,
    };
    return <Context.Provider value={wallet}>{children}</Context.Provider>;
  }
`

const toolFixture = `
  import { encodeFunctionData, erc20Abi, keccak256, stringToHex, parseUnits } from 'viem';
  import { TOKENS } from '/src/lib/wallet.ts';
  import { XYLO_ROUTER, createXyloQuote, minimumSwapOutput } from '/src/migrated/swap.ts';
  import { CCTP_KIT_BRIDGE_TESTNET } from '/src/migrated/cctp.ts';
  const h = () => window.__completionHarness;
  const ok = (data) => ({status: 'OK', data});
  const expiry = () => Date.now() + h().quoteTtl;
  const allowance = () => h().insufficientAllowance || (h().needsApproval && !h().approved) ? 0n : h().needsApproval ? BigInt(h().approvedUnits || '0') : 10000000n;
  const fingerprint = (q) => keccak256(stringToHex(JSON.stringify(q, (key, value) => ['quotedAt', 'expiresAt'].includes(key) ? undefined : typeof value === 'bigint' ? value.toString() : value)));
  const semantics = (q) => ({asset: q.asset, amount: q.amount, expectedReceive: q.expectedReceive,
    destinationChainId: q.destinationChainId, destinationDomain: q.destinationDomain, recipient: q.recipient,
    spender: q.spender, providerFee: q.providerFee, forwarderFee: q.forwarderFee, maxFee: q.maxFee,
    transferSpeed: q.transferSpeed, finalityThreshold: 1000n});
  const action = (kind, q) => {
    const gasLimit = BigInt(h().gasLimit), unitPrice = BigInt(h().gasPrice);
    const value = {kind, account: h().activeAccount, chainId: 5042002, preparedAt: Date.now(), expiresAt: Date.now() + 60_000,
      quoteId: fingerprint(q), executionEnabled: false,
      request: {from: h().activeAccount, to: kind === 'swap' ? XYLO_ROUTER : CCTP_KIT_BRIDGE_TESTNET,
        data: '0x1234', value: '0x0', gas: '0x' + gasLimit.toString(16), gasPrice: '0x' + unitPrice.toString(16)},
      gasEstimate: {gasLimit, unitPrice, maximumFee: gasLimit * unitPrice},
      ...('totalDebit' in q ? {cctp: semantics(q)} : {})};
    h().preparedActions.push(value);
    return value;
  };
  const approval = (input, q) => {
    const value = action('approval', q);
    value.request.to = TOKENS.find((token) => token.sym === input.symbol).address;
    value.request.data = encodeFunctionData({abi: erc20Abi, functionName: 'approve', args: [input.spender, input.amount]});
    if (value.cctp) value.cctp.approvalAmount = input.amount;
    return value;
  };
  export async function readWallet() { h().reads++; return ok({account: h().activeAccount, chainId: h().activeChain}); }
  export async function readBalance() { h().reads++; return ok({units: 10000000n}); }
  export async function readAllowance() { h().reads++; h().allowanceReads++; await h().gate('Allowance'); return ok({units: allowance()}); }
  export async function readGasBalance() { h().reads++; return ok(10000000000000000000n); }
  export async function quoteSwap(_, input) {
    h().quotes.push({kind: 'swap', ...input});
    await h().gate('Quote');
    const units = parseUnits(input.amount, 6), output = h().swapOutput ? BigInt(h().swapOutput) : units;
    return ok({account: input.account, slippage: input.slippage, expiresAt: expiry(),
      quote: createXyloQuote(input.from.toLowerCase(), input.to.toLowerCase(), units, output),
      minimumReceive: minimumSwapOutput(output, input.slippage), balance: 10000000n, allowance: allowance()});
  }
  export async function prepareSwap(_, q) { return action('swap', q); }
  export async function prepareApproval(_, input) { return approval(input, {amount: input.amount, symbol: input.symbol, spender: input.spender}); }
  export async function quoteBridge(_, input) {
    h().quotes.push({kind: 'bridge', ...input});
    await h().gate('Quote');
    if (h().quoteUnavailable) return {status: 'UNAVAILABLE', reason: 'MOCK raw English Circle error'};
    const amount = parseUnits(input.amount, 6), maxFee = BigInt(h().circleFee);
    return ok({account: input.account, asset: 'USDC', sourceChainId: 5042002, destinationChainId: 84532,
      amount, expectedReceive: amount - maxFee, providerFee: maxFee, forwarderFee: 0n, maxFee, totalDebit: amount, transferSpeed: input.transferSpeed,
      spender: CCTP_KIT_BRIDGE_TESTNET, recipient: input.account, destinationDomain: 6, quotedAt: Date.now(), expiresAt: expiry()});
  }
  export async function prepareCctpBurn(_, q) { return action('cctp-burn', q); }
  export async function prepareCctpApproval(_, q) { return approval({symbol: 'USDC', spender: q.spender, amount: q.totalDebit}, q); }
`

const policyFixture = `
  export { evaluateToolPolicy, createReview, revalidateReview, verifyFiniteApproval } from '/src/migrated/policy.ts';
`

const protocolFixture = `
  const h = () => window.__completionHarness;
  export const isWalletRejection = (error) => error?.code === 4001;
  async function submit(kind, action) {
    h().walletRequests.push(kind);
    h().walletActions.push(action);
    await h().gate('Submission');
    if (h().outcome === 'rejected') throw Object.assign(new Error('MOCK user rejected'), {code: 4001});
    if (h().outcome === 'unknown') throw new Error('MOCK wallet transport lost the response');
    return kind === 'approval' ? '${approvalHash}' : kind === 'swap' ? '${swapHash}' : '${sourceHash}';
  }
  export const requestReviewedAction = async (_, action) => submit(action.kind === 'approval' ? 'approval' : 'swap', action);
  export const requestReviewedCctpAction = async (action) => submit(action.kind === 'approval' ? 'approval' : 'bridge', action);
  export async function pollProtocolReceipt(_, action, hash, evidence, onPending) {
    h().receipts.push(hash);
    onPending();
    if (h().holdReceipt) await new Promise((resolve) => { h().releaseReceipt = resolve; });
    await h().gate('Receipt');
    const result = h().receiptOutcome || (h().outcome === 'failed' ? 'failed' : 'confirmed');
    if (action.kind === 'approval' && result === 'confirmed') { h().approved = true; h().approvedUnits = evidence.approval.minimum.toString(); }
    return result;
  }
  export async function checkProtocolReceipt(_, action, hash, evidence) {
    h().reads++; h().recoveries.push({account: action.account, hash});
    await h().gate('Recovery');
    if (h().recoveryError) throw new Error('MOCK recovery unavailable');
    const result = h().recoveryOutcome || 'confirmed';
    if (action.kind === 'approval' && result === 'confirmed') { h().approved = true; h().approvedUnits = evidence.approval.minimum.toString(); }
    return result;
  }
`

const circleFixture = `
  import { getOfficialCctpStatus as readActualCircleStatus } from '/src/protocols/circle/cctpAdapter.ts';
  export const simulatePreparedCctpCall = async () => { await window.__completionHarness.gate('Simulation'); return {success: true}; };
  export { sameCctpActionMaterial, sameCctpQuoteMaterial, cctpGasEstimateChanged, cctpGasCeilingExceeded } from '/src/protocols/circle/cctpAdapter.ts';
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
  const reloaded = sessionStorage.getItem('completion.reload');
  if (!reloaded) { localStorage.clear(); sessionStorage.clear(); }
  localStorage.setItem('mk.lang', q.get('lang') || 'en');
  const previous = {hash: '${previousHash}', account: '${account}', target: '${target}', calldata: '0x1234',
    fromSymbol: 'USDC', toSymbol: 'EURC', minimumOutputUnits: '8999000', timestamp: 1,
    status: 'completed', amount: '9', expectedReceiveUnits: '8999000', destinationDomain: 6, maxFeeUnits: '1000', finalityThreshold: '1000'};
  const h = window.__completionHarness = {
    ready: false, calls: [], quotes: [], walletRequests: [], walletActions: [], preparedActions: [], receipts: [], reads: 0, allowanceReads: 0, statusReads: 0, refreshes: 0,
    gasLimit: '100000', gasPrice: '1', quoteTtl: 60_000, circleFee: '1000',
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
  if (reloaded) Object.assign(h, JSON.parse(reloaded), {
    swap: JSON.parse(localStorage.getItem('mk.swap.records.v1')),
    bridge: JSON.parse(localStorage.getItem('mk.bridge.records.v1')),
  });
  h.reload = () => {
    const saved = Object.fromEntries(['walletRequests', 'receipts', 'quotes', 'approved', 'approvedUnits', 'recoveryOutcome', 'activeAccount', 'activeChain', 'outcome', 'receiptOutcome', 'reboots'].map((key) => [key, h[key]]));
    saved.reboots = (h.reboots || 0) + 1;
    sessionStorage.setItem('completion.reload', JSON.stringify(saved));
    location.reload();
  };
  h.gate = async (name) => {
    if (!h.holds.has(name)) return;
    await new Promise((resolve) => { h.releases[name] = resolve; });
    h.settled[name] = (h.settled[name] || 0) + 1;
  };
  h.release = (name) => { h.holds.delete(name); h.releases[name](); };
  const originalSetItem = Storage.prototype.setItem;
  const originalGetItem = Storage.prototype.getItem;
  const originalStorage = localStorage;
  Storage.prototype.getItem = function(key) {
    if (this === originalStorage && key.startsWith('mk.strategy.') && h.failStrategyRead) throw new Error('MOCK checkpoint read failure');
    return originalGetItem.call(this, key);
  };
  Storage.prototype.setItem = function(key, value) {
    if (this === originalStorage && key.startsWith('mk.strategy.') && h.failStrategySave) throw new Error('MOCK checkpoint storage failure');
    if (this === originalStorage && (key.startsWith('mk.strategy.') || key === 'mk.bridge.records.v1')) h.storageWrites.push({key, value});
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
  if (!reloaded && q.get('lifecycle') === '1' && q.get('seed') !== '0') {
    if (realShape) h.seedRun('${realAccount}', '${realBurnHash}', {
      binding: {from: '${realAccount}', to: '${realBody.messageSender}', data: '0x1234', amount: '1',
        expectedReceiveUnits: '${realReceiveUnits}', recipient: '${realAccount}', destinationDomain: 6,
        maxFeeUnits: '${realBody.maxFee}', finalityThreshold: '${realCircleMessage.decodedMessage.minFinalityThreshold}'},
    });
    else { h.seedRun('${account}', '${sourceHash}'); h.seedRun('${otherAccount}', '${otherSourceHash}'); }
  }
  localStorage.setItem('mk.swap.records.v1', JSON.stringify(h.swap));
  localStorage.setItem('mk.bridge.records.v1', JSON.stringify(h.bridge));
  // Route arcRpc.ts bypass calls to the local Vite mock, not the real Arc RPC.
  // arcRpc.ts reads window.__arcRpcOverrideUrl when set; the guard in arcRpc.ts
  // allows override on localhost (preview server runs on 127.0.0.1).
  // Save original fetch before overriding, so Arc RPC mock requests can still
  // reach the Vite dev server's /__completion_arc_rpc__ endpoint.
  globalThis.__originalFetch = globalThis.fetch;
  window.__arcRpcOverrideUrl = '/__completion_arc_rpc__';
  window.ethereum = {isMetaMask: true, request: async ({method}) => {
    h.calls.push(method);
    // Only wallet-identity and signing methods are handled by the injected provider.
    // All read-only blockchain calls (eth_call, eth_gasPrice, eth_getCode, etc.)
    // are routed through arcRpc.ts → /__completion_arc_rpc__ mock above.
    if (method === 'eth_accounts') return [h.activeAccount];
    if (method === 'eth_chainId') return '0x' + h.activeChain.toString(16);
    if (method === 'wallet_switchEthereumChain') return null;
    throw new Error('Unexpected provider request in MOCKED completion QA: ' + method);
  }};
  window.fetch = async (url, opts) => {
    // Arc RPC mock requests from arcRpc.ts go to the Vite-served /__completion_arc_rpc__
    // endpoint. Pass them through to the real fetch (the Vite dev server handles them).
    if (String(url).startsWith('/__completion_arc_rpc__')) {
      return globalThis.__originalFetch ? globalThis.__originalFetch(url, opts) : fetch.call(undefined, url, opts);
    }
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
  const { LiveSwapControl } = await import('/src/components/LiveSwapControl.tsx');
  function LifecyclePage() {
    const wallet = useWallet();
    const [value, setValue] = useState('1');
    return createElement('div', null,
      createElement('input', {value, onChange: (event) => setValue(event.target.value)}),
      createElement(LiveCctpControl, {account: wallet.address, amount: value, transferSpeed: 'FAST',
        onSourceConfirmed: async () => { h.sourceCallbacks++; await h.gate('SourceCallback'); }, onComplete: () => { h.completeCallbacks++; setValue(''); },
        onQuoteChange: () => { h.quoteCallbacks++; }}));
  }
  function ContinuationPage() {
    const wallet = useWallet();
    const [value, setValue] = useState('1');
    return createElement('div', null,
      createElement('input', {value, onChange: (event) => setValue(event.target.value)}),
      q.get('kind') === 'swap'
        ? createElement(LiveSwapControl, {account: wallet.address, from: 'USDC', to: 'EURC', amount: value, slip: '0.5%',
            onConfirmed: async () => { h.sourceCallbacks++; await h.gate('SourceCallback'); if (h.callbackError) throw new Error('MOCK wallet refresh unavailable'); }, onComplete: () => { h.completeCallbacks++; setValue(''); }})
        : createElement(LiveCctpControl, {account: wallet.address, amount: value, transferSpeed: 'FAST',
            onSourceConfirmed: async () => { h.sourceCallbacks++; await h.gate('SourceCallback'); }, onComplete: () => { h.completeCallbacks++; setValue(''); }}));
  }
  function Remountable() {
    const [epoch, setEpoch] = useState(0);
    h.remount = () => setEpoch((n) => n + 1);
    return createElement(q.get('lifecycle') === '1' ? LifecyclePage : q.get('continuation') === '1' ? ContinuationPage : Component, {key: epoch});
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
  if (baselineRef) for (const file of ['pages/SwapBridge.tsx', 'components/LiveSwapControl.tsx', 'components/LiveCctpControl.tsx', 'migrated/strategyController.ts']) {
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
        // Arc RPC mock endpoint — handles all bypass methods.
        if (req.url?.startsWith('/__completion_arc_rpc__') && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk) => { body += chunk })
          req.on('end', async () => {
            try {
              const { method, params = [], id } = JSON.parse(body)
              const [result, error] = handleCompletionArcRpc(method, params)
              const payload = error
                ? JSON.stringify({ jsonrpc: '2.0', id, error })
                : JSON.stringify({ jsonrpc: '2.0', id, result })
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.end(payload)
            } catch (e) {
              res.statusCode = 400; res.end(JSON.stringify({ error: e.message }))
            }
          })
          return
        }
        if (req.url?.startsWith('/__completion_arc_rpc__') && req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.statusCode = 204; res.end(); return
        }
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

for (const kind of ['swap', 'bridge']) for (const corrupt of ['{}', '[null]']) {
  test(`MOCKED actual-page ${kind} malformed Activity ${corrupt}: completed checkpoint and hash remain visible after reload`, async () => {
    await fixture({kind}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.click(names.confirm)
      if (kind === 'bridge') { await ui.wait(enabled(names.check), 'Source receipt must confirm'); await ui.click(names.check) }
      await ui.wait(enabled(names.done), 'Protocol evidence must complete before corrupt Activity is introduced')
      const completed = await ui.evaluate(runStorage(kind))
      await ui.evaluate(`localStorage.setItem('mk.${kind}.records.v1', ${JSON.stringify(corrupt)})`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(enabled(names.done), 'Malformed ancillary Activity must not crash the restored control')
      assert.ok((await ui.evaluate('document.body.innerText')).includes(kind === 'swap' ? swapHash : sourceHash))
      assert.equal(await ui.evaluate(runStorage(kind)), completed)
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      assert.deepEqual(await ui.evaluate(`${h}.consoleErrors`), [])
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

const approvalLabel = (kind, lang = 'en') => kind === 'swap'
  ? lang === 'vi' ? 'Xác nhận phê duyệt trong ví' : 'Confirm approval in wallet'
  : lang === 'vi' ? 'Xem phê duyệt chính xác' : 'Review exact approval'
const approvalCheck = (kind) => kind === 'swap' ? 'Check receipt again' : 'Check approval receipt'
const runStorage = (kind) => `localStorage.getItem('mk.strategy.v1:${kind === 'swap' ? 'swap' : 'cctp'}:${account}')`

async function prepareApprovalReview(ui, kind, lang = 'en', value = '1') {
  const names = labels(kind, lang)
  await ui.fill(0, value)
  await ui.wait(enabled(names.start), 'An entered amount enables explicit quote preparation')
  await ui.click(names.start)
  await ui.wait(enabled(approvalLabel(kind, lang)), 'Insufficient allowance requires a separately reviewed finite approval')
  assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [], 'Preparing approval has no wallet authority')
  return names
}

for (const kind of ['swap', 'bridge']) for (const lang of ['en', 'vi']) {
  test(`MOCKED ${kind} ${lang}: confirmed approval automatically rereads allowance and prepares a separate explicit action review`, async () => {
    await fixture({kind, lang, approval: '1'}, async (ui) => {
      const names = await prepareApprovalReview(ui, kind, lang)
      await ui.click(approvalLabel(kind, lang))
      await ui.wait(enabled(names.confirm), 'A confirmed approval must prepare the next review without a quote button click')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'], 'Read-only continuation cannot open the second wallet request')
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash])
      assert.equal(await ui.evaluate(`${h}.approved`), true)
      assert.ok(await ui.evaluate(`${h}.allowanceReads >= 1`), 'The confirmed approval must be followed by actual allowance evidence')
      assert.equal(await ui.evaluate(`${h}.quotes.length`), 2, 'A fresh post-approval quote must be obtained automatically')
      assert.equal(await ui.evaluate(amount), '1')
      assert.equal(await ui.evaluate(exists(names.done)), false, 'An approval receipt cannot complete Swap or Bridge')
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1, 'Approval creates no misleading action Activity')
      const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
      assert.equal(saved.phase, 'REVIEW_ACTION')
      assert.equal(saved.hash, undefined, 'The next action cannot inherit the approval hash')
      assert.equal(saved.approvalReceipt.hash, approvalHash, 'Confirmed approval evidence survives preparing the dependent action')
      assert.equal(await ui.evaluate(`${h}.walletActions[0].request.data.endsWith('00000000000000000000000000000000000000000000000000000000000f4240')`), true, 'Approval calldata authorizes exactly one USDC, never an infinite allowance')
      await ui.evaluate(`(() => { const button = ${buttons(names.confirm)}[0]; for (let i = 0; i < 10; i++) button.click(); })()`)
      await ui.wait(kind === 'swap' ? enabled(names.done) : enabled(names.check), 'The explicit second click may submit the independently reviewed action once')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval', kind])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash, kind === 'swap' ? swapHash : sourceHash])
      assert.equal(await ui.evaluate(`${h}.calls.some((method) => ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_sign'].includes(method))`), false)
    })
  })
}

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED ${kind}: rejecting the explicit action after approval preserves approval evidence without action completion or retry`, async () => {
    await fixture({kind, approval: '1'}, async (ui) => {
      const names = await prepareApprovalReview(ui, kind)
      await ui.click(approvalLabel(kind))
      await ui.wait(enabled(names.confirm), 'Approval must prepare a separate action review')
      await ui.evaluate(`${h}.outcome = 'rejected'`)
      await ui.click(names.confirm)
      await ui.wait(enabled(names.start), 'A rejected second wallet request must end without a broadcast')
      assert.match(await ui.evaluate('document.body.innerText'), /Wallet request rejected/)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval', kind])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash], 'A rejected request has no hash or receipt poll')
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1)
      const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
      assert.equal(saved.phase, 'USER_REJECTED')
      assert.equal(saved.hash, undefined)
      assert.equal(saved.approvalReceipt.hash, approvalHash)
      assert.equal(await ui.evaluate(amount), '1')
    })
  })
}

for (const gas of [{limit: '80000', price: '1'}, {limit: '50000', price: '2'}, {limit: '100000', price: '1'}]) {
  test(`MOCKED CCTP gas ${gas.limit} x ${gas.price}: a valid fresh maximum within the reviewed ceiling needs no repeated review`, async () => {
    await fixture({kind: 'bridge'}, async (ui) => {
      const names = labels('bridge')
      await ui.fill(0, '1'); await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'The original 100000 wei ceiling must be reviewed')
      await ui.evaluate(`${h}.gasLimit = '${gas.limit}'; ${h}.gasPrice = '${gas.price}'`)
      await ui.click(names.confirm)
      await ui.wait(enabled(names.check), 'A lower or equal valid gas maximum must submit after this explicit confirmation')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'])
      const sent = await ui.evaluate(`({gas: ${h}.walletActions[0].request.gas, gasPrice: ${h}.walletActions[0].request.gasPrice})`)
      assert.equal(BigInt(sent.gas) * BigInt(sent.gasPrice), BigInt(gas.limit) * BigInt(gas.price))
    })
  })
}

test('MOCKED CCTP gas above ceiling: refreshed maximum requires another explicit review before one wallet request', async () => {
  await fixture({kind: 'bridge'}, async (ui) => {
    const names = labels('bridge')
    await ui.fill(0, '1'); await ui.click(names.start)
    await ui.wait(enabled(names.confirm), 'The original maximum must be reviewed')
    await ui.evaluate(`${h}.gasLimit = '100001'`)
    await ui.click(names.confirm)
    await ui.wait(`document.body.innerText.includes('gas exceeds the reviewed maximum') && ${enabled(names.confirm)}`, 'Exceeding the reviewed ceiling must refresh the review')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    assert.deepEqual(await ui.evaluate(`${h}.receipts`), [])
    await ui.click(names.confirm)
    await ui.wait(enabled(names.check), 'Only a second explicit confirm authorizes the raised ceiling')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'])
  })
})

test('MOCKED Swap material output change: even an improved fresh quote requires explicit new review', async () => {
  await fixture({kind: 'swap'}, async (ui) => {
    const names = labels('swap')
    await ui.fill(0, '1'); await ui.click(names.start)
    await ui.wait(enabled(names.confirm), 'Original output must be reviewed')
    await ui.evaluate(`${h}.swapOutput = '1100000'`)
    await ui.click(names.confirm)
    await ui.wait(enabled(names.start), 'Material fresh quote change must invalidate the old executable review')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
    assert.equal(await ui.evaluate(exists(names.confirm)), false)
    await ui.click(names.start)
    await ui.wait(enabled(names.confirm), 'Explicit start obtains the changed quote for review')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  })
})

for (const change of ['fee', 'expiry']) {
  test(`MOCKED CCTP ${change}: expired review or changed Circle fee cannot submit without refreshed explicit review`, async () => {
    await fixture({kind: 'bridge'}, async (ui) => {
      const names = labels('bridge')
      await ui.fill(0, '1'); await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'Initial CCTP fee and receive floor must be reviewed')
      await ui.evaluate(`(() => { const now = Date.now; Date.now = () => now() + 61_000; ${change === 'fee' ? `${h}.circleFee = '2000';` : ''} })()`)
      await ui.click(names.confirm)
      await ui.wait(`document.body.innerText.includes('${change === 'fee' ? 'Circle fee or request changed' : 'Review expired'}') && ${enabled(names.confirm)}`, 'A changed fee or expired review must expose the refreshed request first')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
      if (change === 'fee') assert.match(await ui.evaluate('document.body.innerText'), /0\.002 USDC/)
      await ui.click(names.confirm)
      await ui.wait(enabled(names.check), 'The refreshed review requires another explicit wallet confirmation')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['bridge'])
    })
  })
}

async function reloadFixture(ui) {
  const previous = await ui.evaluate(`${h}.reboots || 0`)
  await ui.evaluate(`setTimeout(() => ${h}.reload(), 0); undefined`)
  // A real page navigation destroys the old execution context. Retry until the
  // replacement fixture has mounted, preserving only explicit saved evidence.
  const expires = Date.now() + 10_000
  while (Date.now() < expires) {
    try {
      if (await ui.evaluate(`${h}?.ready && ${h}.reboots === ${previous + 1} && !!document.querySelector('input')`)) return
    } catch { /* The navigation briefly has no execution context. */ }
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  assert.fail('The isolated full-page reload did not remount')
}

const restoredAmount = '2.345678'
async function configureActualInputs(ui, kind, lang = 'en') {
  if (kind === 'swap') {
    await ui.evaluate(`document.querySelector('button[aria-label="${lang === 'vi' ? 'Đảo chiều' : 'Flip'}"]').click()`)
    await ui.evaluate(`document.querySelector('button[aria-controls="mk-swap-settings"]').click()`)
    await ui.wait(enabled('1%'), 'The real Swap settings must expose slippage choices')
    await ui.click('1%')
  } else {
    await ui.evaluate(`(() => { const button = [...document.querySelectorAll('button[aria-pressed]')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(lang === 'vi' ? 'Tiêu chuẩn' : 'Standard')})); if (!button) throw new Error('Actual Bridge Standard speed missing'); button.click(); })()`)
  }
  await ui.fill(0, restoredAmount)
}

async function assertActualInputs(ui, kind, lang = 'en') {
  assert.equal(await ui.evaluate(amount), restoredAmount, 'The actual parent must restore the exact nondefault amount')
  if (kind === 'swap') {
    assert.deepEqual(await ui.evaluate(`[...document.querySelectorAll('button > span.font-semibold')].map((span) => span.textContent).filter((label) => ['USDC', 'EURC'].includes(label))`), ['EURC', 'USDC'], 'Input/output tokens must retain their original direction')
    await ui.evaluate(`document.querySelector('button[aria-controls="mk-swap-settings"]').click()`)
    await ui.wait(enabled('1%'), 'Restored Swap settings must remain inspectable')
    assert.equal(await ui.evaluate(`${buttons('1%')}[0].classList.contains('shadow')`), true, 'The actual parent must restore the selected nondefault slippage')
    await ui.evaluate(`document.querySelector('button[aria-controls="mk-swap-settings"]').click()`)
  } else {
    assert.equal(await ui.evaluate(`document.querySelector('button[aria-pressed="true"]').textContent.trim().startsWith(${JSON.stringify(lang === 'vi' ? 'Tiêu chuẩn' : 'Standard')})`), true, 'The actual parent must restore Standard/SLOW transfer speed')
  }
}

async function prepareActualReview(ui, kind, lang = 'en', approval = false) {
  await configureActualInputs(ui, kind, lang)
  const names = labels(kind, lang)
  await ui.click(names.start)
  await ui.wait(enabled(approval ? approvalLabel(kind, lang) : names.confirm), 'The actual page must prepare a separate bounded review')
  assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
  return names
}

function assertFreshInputs(quote, kind) {
  assert.equal(quote.amount, restoredAmount)
  if (kind === 'swap') {
    assert.equal(quote.from, 'EURC'); assert.equal(quote.to, 'USDC'); assert.equal(quote.slippage, 0.01)
  } else assert.equal(quote.transferSpeed, 'SLOW')
}

for (const kind of ['swap', 'bridge']) for (const lang of ['en', 'vi']) {
  test(`MOCKED actual-page ${kind} ${lang} reload after next review: confirmed approval inputs restore but old execution authority expires`, async () => {
    await fixture({kind, lang, approval: '1'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, lang, true)
      await ui.click(approvalLabel(kind, lang))
      await ui.wait(enabled(names.confirm), 'The verified approval must prepare the next explicit action review')
      const previous = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
      assert.equal(previous.phase, 'REVIEW_ACTION')
      assert.equal(previous.approvalReceipt.hash, approvalHash)
      const quoteCount = await ui.evaluate(`${h}.quotes.length`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind, lang)
      await ui.wait(enabled(names.confirm), 'Reloaded approval evidence must obtain new reads and prepare a fresh review')
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quoteCount + 1, 'The previous review must not survive as execution authority')
      assertFreshInputs(await ui.evaluate(`${h}.quotes.at(-1)`), kind)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'], 'Reload may only read; an action still requires its own explicit confirmation')
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash])
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).approvalReceipt.hash`), approvalHash)
      assert.equal(await ui.evaluate(exists(names.done)), false)
    })
  })
}

for (const kind of ['swap', 'bridge']) for (const step of ['approval', 'action']) {
  test(`MOCKED actual-page ${kind} reload with known-hash UNKNOWN ${step}: only receipt checks remain available`, async () => {
    await fixture({kind, approval: step === 'approval' ? '1' : '0'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, 'en', step === 'approval')
      await ui.evaluate(`${h}.receiptOutcome = 'unknown'; ${h}.recoveryOutcome = 'unknown'`)
      await ui.click(step === 'approval' ? approvalLabel(kind) : names.confirm)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'UNKNOWN'`, 'An inconclusive receipt must retain UNKNOWN with the real submitted hash')
      const hash = step === 'approval' ? approvalHash : kind === 'swap' ? swapHash : sourceHash
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), hash)
      const activity = await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`)
      const quoteCount = await ui.evaluate(`${h}.quotes.length`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      const check = step === 'approval' ? approvalCheck(kind) : kind === 'swap' ? 'Check receipt again' : names.check
      await ui.wait(enabled(check), 'UNKNOWN with a known hash must expose only read-only recovery')
      assert.ok((await ui.evaluate('document.body.innerText')).includes(hash))
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.equal(await ui.evaluate(exists(approvalLabel(kind))), false)
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), activity)
      await ui.click(check)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'UNKNOWN' && ${enabled(check)}`, 'An inconclusive read remains UNKNOWN and unlocks a safe status retry')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), hash)
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quoteCount)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [step === 'approval' ? 'approval' : kind])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [hash])
      assert.equal(await ui.evaluate(exists(names.done)), false)
    })
  })

  test(`MOCKED actual-page ${kind} reload with transport-unknown ${step}: preserve input without inventing a hash or retry`, async () => {
    await fixture({kind, approval: step === 'approval' ? '1' : '0'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, 'en', step === 'approval')
      await ui.evaluate(`${h}.outcome = 'unknown'`)
      await ui.click(step === 'approval' ? approvalLabel(kind) : names.confirm)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'UNKNOWN'`, 'A lost wallet response requires external reconciliation')
      const quoteCount = await ui.evaluate(`${h}.quotes.length`)
      const activity = await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), undefined, 'Transport failure cannot fabricate a transaction hash')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.equal(await ui.evaluate(exists(approvalLabel(kind))), false)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(transactionLinks), 0)
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quoteCount)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [step === 'approval' ? 'approval' : kind])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [])
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), activity)
    })
  })
}

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED actual-page ${kind} second reload during fresh quote: confirmed approval and original inputs remain recoverable`, async () => {
    await fixture({kind, approval: '1'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, 'en', true)
      await ui.click(approvalLabel(kind))
      await ui.wait(enabled(names.confirm), 'The first approval must finish before exercising repeated reload')
      await ui.evaluate(`(() => { const url = new URL(location.href); url.searchParams.set('gate', 'Quote'); history.replaceState(null, '', url); })()`)
      await reloadFixture(ui)
      await ui.wait(`!!${h}.releases.Quote`, 'The first restored fresh quote must be in flight')
      await assertActualInputs(ui, kind)
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).approvalReceipt.hash`), approvalHash)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(`!!${h}.releases.Quote`, 'A second reload must still safely resume read-only preparation')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash])
      await settleGate(ui, 'Quote')
      await ui.wait(enabled(names.confirm), 'Only new reads may recreate the independently confirmed action review')
      assertFreshInputs(await ui.evaluate(`${h}.quotes.at(-1)`), kind)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
    })
  })
}

for (const kind of ['swap', 'bridge']) for (const change of ['account', 'chain', 'kind']) {
  test(`MOCKED actual-page ${kind} reload with different ${change}: input stays bound to the original account, Arc chain and protocol`, async () => {
    await fixture({kind, hold: '1'}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releaseReceipt`, 'A known pending action must exist before changing context')
      const saved = await ui.evaluate(runStorage(kind))
      const activity = await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`)
      if (change === 'account') await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
      else if (change === 'chain') await ui.evaluate(`${h}.changeChain(84532)`)
      else await ui.evaluate(`(() => { const url = new URL(location.href); url.searchParams.set('kind', '${kind === 'swap' ? 'bridge' : 'swap'}'); history.replaceState(null, '', url); })()`)
      await reloadFixture(ui)
      assert.equal(await ui.evaluate(amount), '', 'Another wallet context or protocol must never inherit temporary transaction input')
      assert.equal(await ui.evaluate(runStorage(kind)), saved, 'The original recovery checkpoint must remain intact')
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), activity)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      if (change === 'account') assert.equal(await ui.evaluate(transactionLinks), 0, 'Another account must not display the original account transaction')
      if (change === 'kind') await ui.evaluate(`(() => { const url = new URL(location.href); url.searchParams.set('kind', '${kind}'); history.replaceState(null, '', url); })()`)
      else if (change === 'account') await ui.evaluate(`${h}.changeAccount('${account}')`)
      else await ui.evaluate(`${h}.changeChain(5042002)`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(enabled(kind === 'swap' ? 'Check receipt again' : names.check), 'Returning to the original identity may recover its saved transaction')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
    })
  })
}

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED actual-page ${kind} Activity throw: checkpoint already contains submitted hash before ancillary persistence`, async () => {
    await fixture({kind}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.evaluate(`${h}.failActivity = true`)
      await ui.click(names.confirm)
      await ui.wait(`${h}.activityWrites.length > 0`, 'The actual submitted action must attempt Activity persistence')
      const attempt = await ui.evaluate(`${h}.activityWrites[0]`)
      const saved = JSON.parse(attempt.checkpoint)
      assert.equal(saved.hash, kind === 'swap' ? swapHash : sourceHash, 'A failing Activity update must observe the hash already durably saved')
      assert.equal(saved.phase, 'SUBMITTED')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), saved.hash)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(`(${enabled(kind === 'swap' ? 'Check receipt again' : names.check)}) || (${enabled(names.done)})`, 'Activity failure cannot erase saved hash recovery or independently verified completion after a full reload')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1, 'A failed Activity write cannot invent transaction history')
    })
  })

  test(`MOCKED actual-page ${kind} Done then reload: temporary input is cleared while completed Activity stays intact`, async () => {
    await fixture({kind}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.click(names.confirm)
      if (kind === 'bridge') { await ui.wait(enabled(names.check), 'Arc receipt must be confirmed first'); await ui.click(names.check) }
      await ui.wait(enabled(names.done), 'Only complete receipt and destination evidence may expose Done')
      const history = await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`)
      const completed = await ui.evaluate(runStorage(kind))
      const quoteCount = await ui.evaluate(`${h}.quotes.length`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(enabled(names.done), 'A completed transfer reloaded before acknowledgment must still expose Done')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(runStorage(kind)), completed)
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quoteCount)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      await ui.click(names.done)
      await ui.wait(`${amount} === '' && ${exists(names.start)}`, 'Done clears actual parent input')
      const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
      assert.equal(saved.phase, 'IDLE'); assert.equal(saved.input, undefined); assert.equal(saved.hash, undefined); assert.equal(saved.binding, undefined)
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), history)
      const quotes = await ui.evaluate(`${h}.quotes.length`)
      await reloadFixture(ui)
      assert.equal(await ui.evaluate(amount), '', 'Completed temporary input must not return on a later page load')
      assert.equal(await ui.evaluate(transactionLinks), 0)
      assert.equal(await ui.evaluate(`localStorage.getItem('mk.${kind}.records.v1')`), history)
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quotes)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
    })
  })
}

for (const kind of ['swap', 'bridge']) for (const lang of ['en', 'vi']) {
  test(`MOCKED actual-page ${kind} ${lang} Activity remains unavailable through completion and reload: Done preserves the only recovery evidence until history is repaired`, async () => {
    await fixture({kind, lang}, async (ui) => {
      const names = await prepareActualReview(ui, kind, lang)
      await ui.evaluate(`${h}.failActivity = true`)
      await ui.click(names.confirm)
      if (kind === 'bridge') { await ui.wait(enabled(names.check), 'Source evidence survives ancillary Activity failure'); await ui.click(names.check) }
      await ui.wait(enabled(names.done), 'Receipt and destination evidence determine completion even when Activity fails')
      assert.match(await ui.evaluate('document.querySelector("[aria-live=polite]").innerText'), lang === 'vi' ? /Hoạt động/ : /Activity/, 'The ancillary history failure notice must be localized inside the live control')
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1)
      const completed = await ui.evaluate(runStorage(kind))
      await reloadFixture(ui)
      await assertActualInputs(ui, kind, lang)
      await ui.wait(enabled(names.done), 'Verified completion remains available after full reload')
      await ui.evaluate(`${h}.failActivity = true`)
      await ui.click(names.done)
      assert.equal(await ui.evaluate(runStorage(kind)), completed, 'Done cannot erase the only saved transaction evidence while Activity is missing')
      assert.equal(await ui.evaluate(amount), restoredAmount)
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1)
      await ui.evaluate(`${h}.failActivity = false`)
      if (kind === 'bridge') {
        await ui.wait(enabled(names.check), 'Missing destination history requires fresh read-only Circle and Base evidence')
        await ui.click(names.check)
        await ui.wait(`${h}.bridge.some((r) => r.hash === '${sourceHash}' && r.status === 'destination-confirmed')`, 'Independent Circle and Base checks repair the destination history')
      } else {
        await ui.click(names.done)
        await ui.wait(`${h}.swap.some((r) => r.hash === '${swapHash}' && r.status === 'completed')`, 'An explicit acknowledgment may first repair missing Swap history')
      }
      await ui.click(names.done)
      await ui.wait(`${amount} === '' && ${exists(names.start)}`, 'Done may clear the temporary input after history has been repaired')
      const record = await ui.evaluate(`${h}.${kind}.find((r) => r.hash === '${kind === 'swap' ? swapHash : sourceHash}')`)
      assert.equal(record.status, kind === 'swap' ? 'completed' : 'destination-confirmed')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 2)
    })
  })
}

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED actual-page ${kind} silent Activity storage failure: in-memory history cannot authorize clearing the durable recovery checkpoint`, async () => {
    await fixture({kind}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.evaluate(`${h}.silentActivityFailure = true`)
      await ui.click(names.confirm)
      if (kind === 'bridge') { await ui.wait(enabled(names.check), 'Source receipt must confirm'); await ui.click(names.check) }
      await ui.wait(enabled(names.done), 'Protocol evidence completes independently of Activity storage')
      const hash = kind === 'swap' ? swapHash : sourceHash
      assert.equal(await ui.evaluate(`${h}.${kind}.some((r) => r.hash === '${hash}')`), true, 'The fixture must expose the production-like in-memory history update')
      assert.equal(await ui.evaluate(`JSON.parse(localStorage.getItem('mk.${kind}.records.v1')).some((r) => r.hash === '${hash}')`), false, 'The Activity write must actually be missing from durable storage')
      const completed = await ui.evaluate(runStorage(kind))
      await ui.click(names.done)
      assert.equal(await ui.evaluate(runStorage(kind)), completed, 'A swallowed Activity save failure cannot erase the only durable hash')
      assert.equal(await ui.evaluate(amount), restoredAmount)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(enabled(names.done), 'The completed recovery checkpoint must still survive an actual page reload')
      assert.equal(await ui.evaluate(`${h}.${kind}.some((r) => r.hash === '${hash}')`), false)
      if (kind === 'bridge') {
        await ui.wait(enabled(names.check), 'Read-only destination reconciliation repairs missing durable history')
        await ui.click(names.check)
        await ui.wait(`${h}.bridge.some((r) => r.hash === '${hash}' && r.status === 'destination-confirmed')`, 'Only independently reverified Base destination evidence may repair completion history')
      } else {
        await ui.click(names.done)
        await ui.wait(`${h}.swap.some((r) => r.hash === '${hash}' && r.status === 'completed')`, 'A separate Done attempt may first repair verified Swap history')
      }
      assert.equal(await ui.evaluate(`JSON.parse(localStorage.getItem('mk.${kind}.records.v1')).some((r) => r.hash === '${hash}')`), true)
      await ui.click(names.done)
      await ui.wait(`${amount} === '' && ${exists(names.start)}`, 'A later explicit acknowledgment may clear checkpoint input once transaction history is durable')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
    })
  })

  test(`MOCKED actual-page ${kind} wallet refresh callback throws: verified approval and submitted action evidence remain intact`, async () => {
    await fixture({kind, approval: '1'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, 'en', true)
      await ui.evaluate(`${h}.callbackError = true`)
      await ui.click(approvalLabel(kind))
      await ui.wait(enabled(names.confirm), 'An ancillary refresh failure cannot block fresh verified allowance and quote reads')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).approvalReceipt.hash`), approvalHash)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
      await ui.click(names.confirm)
      await ui.wait(kind === 'swap' ? enabled(names.done) : enabled(names.check), 'The separately authorized action must retain its independently confirmed receipt')
      const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
      assert.equal(saved.hash, kind === 'swap' ? swapHash : sourceHash)
      assert.equal(saved.phase, kind === 'swap' ? 'COMPLETED' : 'SOURCE_CONFIRMED')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval', kind])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash, kind === 'swap' ? swapHash : sourceHash])
    })
  })
}

for (const kind of ['swap', 'bridge']) for (const lang of ['en', 'vi']) {
  test(`MOCKED actual-page ${kind} ${lang} returned hash with checkpoint storage failure: retain mounted evidence and block duplicate send`, async () => {
    await fixture({kind, lang, gate: 'Submission'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, lang)
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releases.Submission`, 'The wallet request must have been sent before storage becomes unavailable')
      await ui.evaluate(`${h}.failStrategySave = true`)
      await settleGate(ui, 'Submission')
      const hash = kind === 'swap' ? swapHash : sourceHash
      await ui.wait(`document.body.innerText.includes('${hash}')`, 'The real returned hash must remain visible even if its checkpoint cannot be saved')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), undefined, 'The fixture must prove the checkpoint write actually failed')
      assert.match(await ui.evaluate('document.querySelector("[aria-live=polite]").innerText'), lang === 'vi' ? /khôi phục/ : /Recovery/, 'The recovery persistence failure notice must be localized')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      assert.equal(await ui.evaluate(`${h}.${kind}.find((r) => r.hash === '${hash}').hash`), hash, 'Activity remains an independent attempt to retain the returned hash')
      await ui.evaluate(`${h}.failStrategySave = false; ${h}.recoveryOutcome = 'pending'`)
      const check = kind === 'swap' ? lang === 'vi' ? 'Kiểm tra lại biên nhận' : 'Check receipt again' : names.check
      await ui.wait(enabled(check), 'The mounted returned hash must retain an explicit read-only receipt check')
      await ui.click(check)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'PENDING' && ${enabled(check)}`, 'A fresh read after storage recovery may durably save pending evidence')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), hash)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind], 'Repairing recovery persistence must never submit again')
    })
  })
}

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED actual-page ${kind} reload after confirmed approval: saved evidence resumes read-only review without another approval or action request`, async () => {
    await fixture({kind, approval: '1', hold: '1'}, async (ui) => {
      await configureActualInputs(ui, kind)
      const names = await prepareApprovalReview(ui, kind, 'en', restoredAmount)
      await ui.click(approvalLabel(kind))
      await ui.wait(`!!${h}.releaseReceipt`, 'The separately submitted approval must be receipt-pending first')
      await ui.evaluate(`${h}.holds.add('SourceCallback'); ${h}.releaseReceipt()`)
      await ui.wait(`!!${h}.releases.SourceCallback`, 'The fixture must record confirmed approval before its continuation callback returns')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).phase`), 'REVALIDATING')
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(enabled(names.confirm), 'A full reload must safely reconstruct a fresh action review from confirmed approval evidence')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash])
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).approvalReceipt.hash`), approvalHash)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(amount), restoredAmount)
    })
  })

  test(`MOCKED actual-page ${kind} reload with pending approval: saved hash stays read-only through pending and confirmed checks without duplicate sends`, async () => {
    await fixture({kind, approval: '1', hold: '1'}, async (ui) => {
      await configureActualInputs(ui, kind)
      const names = await prepareApprovalReview(ui, kind, 'en', restoredAmount)
      await ui.click(approvalLabel(kind))
      await ui.wait(`!!${h}.releaseReceipt`, 'Approval hash must be saved while receipt is pending')
      await ui.evaluate(`${h}.recoveryOutcome = 'pending'`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      await ui.wait(enabled(approvalCheck(kind)), 'Reload must restore only the saved approval receipt check')
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.ok((await ui.evaluate('document.body.innerText')).includes(approvalHash))
      await ui.click(approvalCheck(kind))
      await ui.wait(`${h}.recoveries.length === 1 && ${enabled(approvalCheck(kind))}`, 'A pending recovery must stay pending and unlock a safe read-only retry')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).phase`), 'PENDING')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      await ui.evaluate(`${h}.recoveryOutcome = 'confirmed'`)
      await ui.click(approvalCheck(kind))
      await ui.wait(enabled(names.confirm), 'A confirmed read-only recovery must continue to the fresh action review')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash])
      assert.equal(await ui.evaluate(`${h}.statusReads`), 0, 'Approval recovery must never query Circle as though a burn already happened')
      assert.equal(await ui.evaluate(`${h}.destinationReads`), 0)
      assert.equal(await ui.evaluate(exists(names.done)), false)
    })
  })

  test(`MOCKED ${kind} approval confirmed but allowance insufficient: continuation blocks without silently skipping or resubmitting approval`, async () => {
    await fixture({kind, approval: '1', hold: '1'}, async (ui) => {
      const names = await prepareApprovalReview(ui, kind)
      await ui.click(approvalLabel(kind))
      await ui.wait(`!!${h}.releaseReceipt`, 'Approval must wait for explicit receipt evidence')
      await ui.evaluate(`${h}.insufficientAllowance = true; ${h}.releaseReceipt()`)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'BLOCKED'`, 'Allowance evidence must block a dependent action when still insufficient')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.equal(await ui.evaluate(exists(names.done)), false)
      assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1)
    })
  })

  for (const change of ['account', 'amount']) {
    test(`MOCKED ${kind} approval continuation: ${change} change discards the delayed post-approval quote without an action request`, async () => {
      await fixture({kind, approval: '1', hold: '1'}, async (ui) => {
        const names = await prepareApprovalReview(ui, kind)
        await ui.click(approvalLabel(kind))
        await ui.wait(`!!${h}.releaseReceipt`, 'Approval must have a recorded pending hash')
        await ui.evaluate(`${h}.holds.add('Quote'); ${h}.releaseReceipt()`)
        await ui.wait(`!!${h}.releases.Quote`, 'The automatic post-approval quote must be held read-only')
        await ui.evaluate(`${h}.staleQuoteRelease = ${h}.releases.Quote; ${h}.holds.delete('Quote')`)
        if (change === 'account') await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
        else await ui.fill(0, '2')
        await ui.evaluate('new Promise((resolve) => setTimeout(resolve, 80))')
        const before = await ui.evaluate(`JSON.stringify({run: ${runStorage(kind)}, prepared: ${h}.preparedActions.length, requests: ${h}.walletRequests})`)
        await ui.evaluate(`${h}.staleQuoteRelease()`)
        await ui.wait(`${h}.settled.Quote === 1`, 'The original post-approval quote must settle')
        await ui.evaluate('new Promise((resolve) => setTimeout(resolve, 50))')
        assert.equal(await ui.evaluate(`JSON.stringify({run: ${runStorage(kind)}, prepared: ${h}.preparedActions.length, requests: ${h}.walletRequests})`), before, 'The stale quote cannot change the current run or publish a prepared action')
        assert.equal(await ui.evaluate(exists(names.confirm)), false, 'A stale continuation cannot publish an executable review')
        assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
        assert.equal(await ui.evaluate(exists(names.done)), false)
      })
    })
  }
}

test('MOCKED Swap approval continuation survives an ancillary wallet refresh callback failure', async () => {
  await fixture({kind: 'swap', approval: '1', continuation: '1'}, async (ui) => {
    const names = await prepareApprovalReview(ui, 'swap')
    await ui.evaluate(`${h}.callbackError = true`)
    await ui.click(approvalLabel('swap'))
    await ui.wait(enabled(names.confirm), 'A refresh callback failure cannot erase verified approval or prevent fresh allowance and quote reads')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval'])
    assert.equal(await ui.evaluate(`${h}.quotes.length`), 2)
    assert.equal(await ui.evaluate(`JSON.parse(${runStorage('swap')}).approvalReceipt.hash`), approvalHash)
    assert.equal(await ui.evaluate(exists(names.done)), false)
  })
})

test('MOCKED Swap stale Done cannot erase a newer saved pending transfer', async () => {
  await fixture({kind: 'swap'}, async (ui) => {
    const names = await submit(ui, 'swap')
    await ui.wait(enabled(names.done), 'This tab must have independently verified its completed swap')
    await ui.evaluate(`(() => { const saved = JSON.parse(${runStorage('swap')}); saved.phase = 'PENDING'; saved.hash = '${otherSourceHash}'; saved.updatedAt += 1; localStorage.setItem('mk.strategy.v1:swap:${account}', JSON.stringify(saved)); })()`)
    const replacement = await ui.evaluate(runStorage('swap'))
    const activity = await ui.evaluate(`localStorage.getItem('mk.swap.records.v1')`)
    await ui.click(names.done)
    assert.equal(await ui.evaluate(runStorage('swap')), replacement, 'Acknowledging an old completion cannot overwrite the newer checkpoint')
    assert.equal(await ui.evaluate(`localStorage.getItem('mk.swap.records.v1')`), activity)
    assert.equal(await ui.evaluate(amount), '1')
    assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['swap'])
  })
})

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED actual-page ${kind} reload with pending action: saved transaction remains pending through read-only receipt recovery`, async () => {
    await fixture({kind, hold: '1'}, async (ui) => {
      await configureActualInputs(ui, kind)
      const names = labels(kind)
      await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'The actual page must prepare the entered nondefault transaction')
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releaseReceipt`, 'The action must have a known hash and remain pending')
      await ui.evaluate(`${h}.recoveryOutcome = 'pending'`)
      const quoteCount = await ui.evaluate(`${h}.quotes.length`)
      await reloadFixture(ui)
      await assertActualInputs(ui, kind)
      const check = kind === 'swap' ? 'Check receipt again' : names.check
      await ui.wait(enabled(check), 'Full reload must restore a read-only receipt check for the known hash')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      await ui.click(check)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'PENDING' && ${enabled(check)}`, 'Independent pending evidence must remain PENDING')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [kind === 'swap' ? swapHash : sourceHash])
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quoteCount, 'Reload/recovery cannot silently prepare another transaction')
      assert.equal(await ui.evaluate(exists(names.done)), false)
    })
  })

  for (const change of ['account', 'chain']) {
    test(`MOCKED ${kind} late wallet hash after ${change} change: original checkpoint and Activity retain submitted evidence without a duplicate send`, async () => {
      await fixture({kind, gate: 'Submission'}, async (ui) => {
        const names = await submit(ui, kind)
        await ui.wait(`!!${h}.releases.Submission`, 'The wallet request must be in flight before its response is delayed')
        const sentBinding = await ui.evaluate(`JSON.parse(${runStorage(kind)}).binding`)
        if (change === 'account') await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
        else await ui.evaluate(`${h}.changeChain(84532)`)
        await ui.evaluate('new Promise((resolve) => setTimeout(resolve, 50))')
        const currentAccountCheckpoint = change === 'account'
          ? await ui.evaluate(`localStorage.getItem('mk.strategy.v1:${kind === 'swap' ? 'swap' : 'cctp'}:${otherAccount}')`)
          : undefined
        await settleGate(ui, 'Submission')
        const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
        assert.equal(saved.phase, 'SUBMITTED', 'A known returned hash must be saved even after its original UI context changed')
        assert.equal(saved.hash, kind === 'swap' ? swapHash : sourceHash)
        assert.deepEqual(saved.binding, sentBinding)
        const record = await ui.evaluate(`${h}.${kind}.find((record) => record.hash === '${kind === 'swap' ? swapHash : sourceHash}')`)
        assert.equal(record.account, account)
        assert.equal(record.amount, '1')
        assert.equal(record.status, kind === 'swap' ? 'pending' : 'source-pending')
        if (change === 'account') assert.equal(await ui.evaluate(`localStorage.getItem('mk.strategy.v1:${kind === 'swap' ? 'swap' : 'cctp'}:${otherAccount}')`), currentAccountCheckpoint, 'The new account checkpoint cannot be overwritten by the old wallet response')
        assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
        assert.deepEqual(await ui.evaluate(`${h}.receipts`), [], 'An invalidated UI must leave receipt tracking to explicit saved-state recovery')
        assert.equal(await ui.evaluate(exists(names.done)), false)
        if (change === 'account') await ui.evaluate(`${h}.changeAccount('${account}')`)
        else await ui.evaluate(`${h}.changeChain(5042002)`)
        await ui.wait(enabled(kind === 'swap' ? 'Check receipt again' : names.check), 'Returning to the original context must expose saved hash recovery')
        assert.equal(await ui.evaluate(exists(names.start)), false)
        assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      })
    })
  }

  for (const outcome of ['rejected', 'unknown']) {
    test(`MOCKED ${kind} late wallet ${outcome} after account change preserves the original request outcome without fabricated hash`, async () => {
      await fixture({kind, gate: 'Submission', outcome}, async (ui) => {
        await submit(ui, kind)
        await ui.wait(`!!${h}.releases.Submission`, 'Wallet outcome must be delayed until its account context is gone')
        await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
        await ui.evaluate('new Promise((resolve) => setTimeout(resolve, 50))')
        await settleGate(ui, 'Submission')
        const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
        assert.equal(saved.phase, outcome === 'rejected' ? 'USER_REJECTED' : 'UNKNOWN')
        assert.equal(saved.hash, undefined, 'A wallet error cannot invent transaction evidence')
        assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
        assert.deepEqual(await ui.evaluate(`${h}.receipts`), [])
        assert.equal(await ui.evaluate(`${h}.${kind}.length`), 1)
      })
    })
  }
}

for (const change of ['account', 'amount', 'chain']) {
  test(`MOCKED Swap ${change} change invalidates an existing review before any wallet request`, async () => {
    await fixture({kind: 'swap'}, async (ui) => {
      const names = labels('swap')
      await ui.fill(0, '1'); await ui.click(names.start)
      await ui.wait(enabled(names.confirm), 'An explicit swap review must be ready first')
      if (change === 'account') await ui.evaluate(`${h}.changeAccount('${otherAccount}')`)
      else if (change === 'chain') await ui.evaluate(`${h}.changeChain(84532)`)
      else await ui.fill(0, '2')
      await ui.wait(`!(${exists(names.confirm)})`, 'Changing reviewed input or connected context invalidates executable authority')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [])
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [])
    })
  })
}

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


for (const kind of ['swap', 'bridge']) for (const step of ['approval', 'action']) {
  test(`MOCKED security ${kind} ${step}: unreadable checkpoint retains the actual returned hash without permitting writes or duplicate sends`, async () => {
    await fixture({kind, approval: step === 'approval' ? '1' : '0'}, async (ui) => {
      const names = await prepareActualReview(ui, kind, 'en', step === 'approval')
      await ui.evaluate(`${h}.holds.add('Submission')`)
      await ui.click(step === 'approval' ? approvalLabel(kind) : names.confirm)
      await ui.wait(`!!${h}.releases.Submission`, 'The user-authorized wallet request must already be pending')
      const saved = await ui.evaluate(runStorage(kind))
      const writes = await ui.evaluate(`${h}.storageWrites.filter(w => w.key.startsWith('mk.strategy.')).length`)
      await ui.evaluate(`${h}.failStrategyRead = true; ${h}.release('Submission')`)
      const hash = step === 'approval' ? approvalHash : kind === 'swap' ? swapHash : sourceHash
      await ui.wait(`document.body.innerText.includes('${hash}') && document.body.innerText.includes('Recovery could not be saved')`, 'The actual returned hash must remain visible with a persistence warning')
      const check = step === 'approval' ? approvalCheck(kind) : kind === 'swap' ? 'Check receipt again' : names.check
      await ui.wait(enabled(check), 'Only an explicit read-only receipt check may remain available')
      assert.deepEqual(await ui.evaluate(`${h}.receipts`), [], 'An unverified checkpoint must not permit automatic receipt continuation')
      assert.equal(await ui.evaluate(`${h}.storageWrites.filter(w => w.key.startsWith('mk.strategy.')).length`), writes, 'A failed checkpoint read must not be treated as permission to write')
      if (step === 'action') assert.equal(await ui.evaluate(`${h}.${kind}.some(r => r.hash === '${hash}')`), true, 'Activity remains independently available despite checkpoint reads failing')
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      await ui.click(check)
      assert.deepEqual(await ui.evaluate(`${h}.recoveries`), [], 'Unreadable checkpoint identity blocks even read-only recovery until it can be reconciled')
      await ui.evaluate(`${h}.failStrategyRead = false; ${h}.recoveryOutcome = 'pending'`)
      assert.equal(await ui.evaluate(runStorage(kind)), saved, 'The last durable AWAITING_USER checkpoint must remain unchanged')
      await ui.click(check)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'PENDING' && ${enabled(check)}`, 'Recovering reads may reconcile the actual hash only against the same durable revision')
      assert.equal(await ui.evaluate(`JSON.parse(${runStorage(kind)}).hash`), hash)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [step === 'approval' ? 'approval' : kind])
    })
  })
}

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED security ${kind}: unreadable checkpoint hash fallback cannot overwrite a newer pending run`, async () => {
    await fixture({kind}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.evaluate(`${h}.holds.add('Submission')`); await ui.click(names.confirm)
      await ui.wait(`!!${h}.releases.Submission`, 'The original request must wait in the wallet')
      const replacement = await ui.evaluate(`(() => { const saved = JSON.parse(${runStorage(kind)}); saved.phase = 'PENDING'; saved.hash = '${otherSourceHash}'; saved.updatedAt++; const value = JSON.stringify(saved); localStorage.setItem('mk.strategy.v1:${kind === 'swap' ? 'swap' : 'cctp'}:${account}', value); return value; })()`)
      await ui.evaluate(`${h}.failStrategyRead = true; ${h}.release('Submission')`)
      const hash = kind === 'swap' ? swapHash : sourceHash
      await ui.wait(`document.body.innerText.includes('${hash}') && document.body.innerText.includes('Recovery could not be saved')`, 'Only actual original request evidence may be retained in its mounted UI')
      await ui.evaluate(`${h}.failStrategyRead = false`)
      const check = kind === 'swap' ? 'Check receipt again' : names.check
      await ui.click(check)
      assert.equal(await ui.evaluate(runStorage(kind)), replacement, 'The exact durable checkpoint guard must still reject this stale request')
      assert.deepEqual(await ui.evaluate(`${h}.recoveries`), [])
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      assert.equal(await ui.evaluate(exists(names.start)), false)
    })
  })
}

for (const kind of ['swap', 'bridge']) for (const lang of ['en', 'vi']) {
  test(`MOCKED security ${kind} ${lang}: transport UNKNOWN after approval never reuses historical approval hash before or after reload`, async () => {
    await fixture({kind, lang, approval: '1'}, async (ui) => {
      const names = await prepareApprovalReview(ui, kind, lang)
      await ui.click(approvalLabel(kind, lang)); await ui.wait(enabled(names.confirm), 'Approval may only prepare a fresh separately reviewed action')
      assert.equal(await ui.evaluate(transactionLinks), 0, 'A fresh action review must not display its historical approval as its current hash')
      await ui.evaluate(`${h}.outcome = 'unknown'`); await ui.click(names.confirm)
      await ui.wait(`JSON.parse(${runStorage(kind)}).phase === 'UNKNOWN'`, 'A lost action wallet response must remain UNKNOWN')
      const quoteCount = await ui.evaluate(`${h}.quotes.length`)
      for (const reload of [false, true]) {
        if (reload) await reloadFixture(ui)
        const saved = await ui.evaluate(`JSON.parse(${runStorage(kind)})`)
        assert.equal(saved.hash, undefined, 'No swap/burn hash was returned')
        assert.equal(saved.approvalReceipt.hash, approvalHash, 'Confirmed approval remains historical evidence')
        assert.equal(await ui.evaluate(transactionLinks), 0, 'Approval evidence must not impersonate a current action hash')
        assert.ok((await ui.evaluate('document.body.innerText')).includes(lang === 'vi'
          ? 'Ví không trả về mã giao dịch. Hãy kiểm tra lịch sử trong ví hoặc trình khám phá trước khi thử lại. Không gửi lại giao dịch.'
          : 'The wallet did not return a transaction hash. Check your wallet history or explorer before any new attempt. Do not resubmit.'), 'A no-hash UNKNOWN must direct external reconciliation and prohibit resubmission')
        assert.equal(await ui.evaluate(exists(kind === 'swap' ? lang === 'vi' ? 'Ki\u1ec3m tra l\u1ea1i bi\u00ean nh\u1eadn' : 'Check receipt again' : names.check)), false, 'No action hash means there is no action receipt to check')
        assert.equal(await ui.evaluate(exists(names.start)), false)
        assert.equal(await ui.evaluate(exists(names.confirm)), false)
        assert.equal(await ui.evaluate(exists(names.done)), false)
        assert.equal(await ui.evaluate(`${h}.quotes.length`), quoteCount)
        assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), ['approval', kind])
        assert.deepEqual(await ui.evaluate(`${h}.receipts`), [approvalHash])
      }
    })
  })
}

for (const change of ['amount', 'speed']) for (const approval of [false, true]) {
  test(`MOCKED security CCTP ${change} edit after ${approval ? 'approval' : 'burn'} review: an explicit fresh start safely replaces only an unsubmitted review`, async () => {
    await fixture({kind: 'bridge', approval: approval ? '1' : '0'}, async (ui) => {
      const names = labels('bridge')
      await ui.fill(0, '1'); await ui.click(names.start)
      const confirm = approval ? approvalLabel('bridge') : names.confirm
      await ui.wait(enabled(confirm), 'The original unsubmitted review must be prepared')
      if (change === 'amount') await ui.fill(0, '0.5')
      else await ui.evaluate(`(() => { const button = [...document.querySelectorAll('button[aria-pressed]')].find(b => b.textContent.trim().startsWith('Standard')); button.click(); })()`)
      await ui.wait(enabled(names.start), 'Editing inputs must expire the old review')
      await ui.click(names.start); await ui.wait(enabled(confirm), 'An explicit restart must prepare a new bounded review for the edited inputs')
      const saved = await ui.evaluate(`JSON.parse(${runStorage('bridge')})`)
      assert.equal(saved.input.amount, change === 'amount' ? '0.5' : '1')
      assert.equal(saved.input.transferSpeed, change === 'speed' ? 'SLOW' : 'FAST')
      assert.equal(saved.hash, undefined)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [], 'Replacing an unsubmitted review never sends automatically')
    })
  })
}


for (const kind of ['swap', 'bridge']) {
  test(`MOCKED security ${kind}: remount with unreadable checkpoint cannot erase pending evidence or prepare another request`, async () => {
    await fixture({kind, hold: '1'}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releaseReceipt`, 'The original submitted transaction must have a real returned hash and pending receipt')
      const saved = await ui.evaluate(runStorage(kind))
      assert.equal(JSON.parse(saved).phase, 'PENDING')
      const quotes = await ui.evaluate(`${h}.quotes.length`)
      const writes = await ui.evaluate(`${h}.storageWrites.filter(w => w.key.startsWith('mk.strategy.')).length`)
      await ui.evaluate(`${h}.failStrategyRead = true; ${h}.remount()`)
      await ui.wait(exists(names.start), 'The unavailable checkpoint may not be restored as executable authority')
      await ui.fill(0, '2'); await ui.click(names.start)
      await ui.wait(`document.body.innerText.includes('strategy state is unavailable')`, 'An explicit action must explain the unavailable checkpoint instead of silently failing')
      assert.equal(await ui.evaluate(`${h}.storageWrites.filter(w => w.key.startsWith('mk.strategy.')).length`), writes, 'Unknown checkpoint identity cannot authorize replacing the saved pending state')
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quotes, 'No new review may be prepared while identity is unreadable')
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      await ui.evaluate(`${h}.failStrategyRead = false`)
      assert.equal(await ui.evaluate(runStorage(kind)), saved, 'Pending checkpoint bytes must survive the entire outage and attempted start')
      await ui.evaluate(`${h}.remount()`)
      const check = kind === 'swap' ? 'Check receipt again' : names.check
      await ui.wait(enabled(check), 'Recovered reads and remount must restore only the original pending receipt check')
      const hash = kind === 'swap' ? swapHash : sourceHash
      assert.ok((await ui.evaluate('document.body.innerText')).includes(hash))
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quotes)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
    })
  })
}


for (const kind of ['swap', 'bridge']) {
  test(`MOCKED security ${kind}: blocked localStorage property on remount renders an availability error and preserves pending recovery`, async () => {
    await fixture({kind, hold: '1'}, async (ui) => {
      const names = await prepareActualReview(ui, kind)
      await ui.click(names.confirm)
      await ui.wait(`!!${h}.releaseReceipt`, 'The submitted hash must already be durable with a pending receipt')
      const saved = await ui.evaluate(runStorage(kind))
      const quotes = await ui.evaluate(`${h}.quotes.length`)
      const errors = await ui.evaluate(`${h}.consoleErrors.length`)
      await ui.evaluate(`(() => {
        const storage = localStorage, descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
        ${h}.rawCheckpoint = () => storage.getItem('mk.strategy.v1:${kind === 'swap' ? 'swap' : 'cctp'}:${account}');
        ${h}.restoreStorageProperty = () => Object.defineProperty(window, 'localStorage', descriptor);
        Object.defineProperty(window, 'localStorage', {configurable: true, get() { throw new DOMException('MOCK storage policy denied', 'SecurityError'); }});
        ${h}.remount();
      })()`)
      await ui.wait(`document.body.innerText.includes('strategy state is unavailable')`, 'The actual page and control must render storage availability guidance instead of crashing')
      assert.equal(await ui.evaluate(`${h}.rawCheckpoint()`), saved)
      assert.equal(await ui.evaluate(`${h}.consoleErrors.length`), errors, 'Blocked property access may not become an uncaught React exception')
      await ui.fill(0, '2'); await ui.click(names.start)
      assert.equal(await ui.evaluate(`${h}.rawCheckpoint()`), saved, 'No unavailable property may authorize discarding the original recovery checkpoint')
      assert.equal(await ui.evaluate(`${h}.quotes.length`), quotes)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
      await ui.evaluate(`${h}.restoreStorageProperty(); ${h}.remount()`)
      await ui.wait(enabled(kind === 'swap' ? 'Check receipt again' : names.check), 'Restored storage and remount recover the original pending hash read-only')
      assert.ok((await ui.evaluate('document.body.innerText')).includes(kind === 'swap' ? swapHash : sourceHash))
      assert.equal(await ui.evaluate(runStorage(kind)), saved)
      assert.equal(await ui.evaluate(exists(names.start)), false)
      assert.equal(await ui.evaluate(exists(names.confirm)), false)
      assert.deepEqual(await ui.evaluate(`${h}.walletRequests`), [kind])
    })
  })
}

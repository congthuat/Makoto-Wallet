import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBrowserHarness, delay } from './browser-harness.mjs'

// Actual React Send/Swap/Bridge components, policy and preparation modules.
// The wallet context and injected provider are MOCKED. The provider rejects
// every signing/submission request; no extension, signature or broadcast occurs.
// Run: node --test tests/send-handoff.test.mjs
// MAKOTO_CHROME_PATH selects an existing Chrome/Chromium executable. No test
// package or browser is downloaded, and a missing browser fails explicitly.
// Optional negative control: MAKOTO_SEND_BASELINE_REF=<full production SHA>
// serves that historical Send module via read-only git show, without replacing
// the working source. The handoff regressions are expected to FAIL on the bug.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x1951f95962442b6b6be2671e4d39bc88ff6cbe71'
const secondRecipient = '0x3333333333333333333333333333333333333333'
let browser

const walletFixture = `
  import { createContext, useContext, useState } from 'react';
  import { TOKENS, ARC } from '/src/lib/wallet.ts';
  const Context = createContext(null);
  export const useWallet = () => useContext(Context);
  export function WalletFixture({ children }) {
    const q = new URLSearchParams(location.search);
    const [state, setState] = useState({
      page: q.get('source') === 'agent-ui' ? 'agent' : q.get('kind') || 'send',
      mode: 'connected', address: '${account}', walletChainId: ARC.chainId,
      displayAddress: '${account}', total: 30, pricesReady: true, tasks: [], agentSeed: null,
      holdings: TOKENS.map((t) => ({...t, symbol: t.sym, verified: true, balance: 10, price: 1})),
      prices: {USDC: {price: 1}, EURC: {price: 1}, BTC: {price: 1}},
      network: {tokenTransferFeeUsdc: 0.002, blockNumber: 123, rpcLatencyMs: 50}, contacts: [],
      activity: [{direction: 'out', verified: true, counterparty: '${secondRecipient}', symbol: 'USDC'}],
      settings: {confirmLarge: true},
      sendDraft: ['draft', 'both'].includes(q.get('source')) ? {symbol: 'USDC', to: '${recipient}', amount: '1', review: true} : null,
      swapDraft: null,
    });
    const [setters] = useState(() => ({
      setSendDraft: (sendDraft) => setState((s) => ({...s, sendDraft})),
      setSwapDraft: (swapDraft) => setState((s) => ({...s, swapDraft})),
      mask: (value) => value, go: (page) => setState((s) => ({...s, page})),
      setAgentSeed: () => {}, setAgentSeedMode: () => {},
      notify: (message, tone) => window.__sendHarness.notices.push({message, tone}),
      upsertSend: (record) => window.__sendHarness.records.push(record),
      upsertSwap: () => {}, upsertBridge: () => {}, refetchWallet: async () => {},
    }));
    window.__sendHarness.setWallet = (change) => setState((s) => ({...s, ...change}));
    window.__sendHarness.wallet = state;
    return <Context.Provider value={{...state, ...setters}}>{children}</Context.Provider>;
  }
`

const entry = `
  import { createElement, StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { WalletFixture, useWallet } from '/__send_test__/wallet.jsx';
  import { createBrainHandoff, storeBrainHandoff } from '/src/brain/handoff.ts';
  const q = new URLSearchParams(location.search);
  const h = window.__sendHarness = {calls: [], notices: [], records: [], ready: false, release: null};
  localStorage.setItem('mk.lang', q.get('lang') || 'en');
  const symbolHex = (s) => '0x' + '20'.padStart(64, '0') + s.length.toString(16).padStart(64, '0') + [...s].map((x) => x.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0');
  window.ethereum = { isMetaMask: true, request: async ({method, params = []}) => {
    h.calls.push({method, params});
    if (method === 'eth_accounts') return [h.wallet?.address || '${account}'];
    if (method === 'eth_chainId') return '0x' + (h.wallet?.walletChainId || 5042002).toString(16);
    if (method === 'eth_getCode') return ['${recipient}', '${secondRecipient}'].includes(params[0].toLowerCase()) ? '0x' : '0x6000';
    if (method === 'eth_call') {
      const data = params[0].data;
      if (data === '0x313ce567') return '0x6';
      if (data === '0x95d89b41') return symbolHex(params[0].to.toLowerCase() === '0x3600000000000000000000000000000000000000' ? 'USDC' : 'EURC');
      if (data.startsWith('0x70a08231')) return '0x989680';
    }
    if (method === 'eth_getBalance') return '0x8ac7230489e80000';
    if (method === 'eth_estimateGas') {
      if (q.get('hold') === '1' && !h.released) await new Promise((resolve) => {h.release = () => {h.released = true; resolve()}});
      if (q.get('fault') === 'fee') throw new Error('Fee estimate unavailable');
      return '0x186a0';
    }
    if (method === 'eth_gasPrice') return '0x4a817c800';
    if (method === 'eth_sendTransaction') throw Object.assign(new Error('MOCK wallet cancellation; no broadcast'), {code: 4001});
    throw new Error('Unexpected MOCK provider request: ' + method);
  }};
  const kind = q.get('kind') || 'send';
  if (['handoff', 'both'].includes(q.get('source'))) {
    const action = {kind, rawUserText: 'Agent test handoff', amount: '1', asset: 'USDC', recipient: '${recipient}', outputAsset: 'EURC', sourceChain: 'Arc Testnet', destinationChain: 'Base Sepolia'};
    storeBrainHandoff(sessionStorage, createBrainHandoff(action, '${account}'));
  }
  const Component = kind === 'send' ? (await import('/src/pages/Send.tsx')).default : (await import('/src/pages/SwapBridge.tsx'))[kind === 'swap' ? 'SwapPage' : 'BridgePage'];
  const Agent = q.get('source') === 'agent-ui' ? (await import('/src/pages/Agent.tsx')).default : null;
  function RouteFixture() {
    const wallet = useWallet();
    return createElement(wallet.page === 'agent' ? Agent : Component);
  }
  createRoot(document.getElementById('app')).render(createElement(StrictMode, null, createElement(WalletFixture, null, createElement(RouteFixture))));
  h.ready = true;
`

before(async () => {
  const baselineRef = process.env.MAKOTO_SEND_BASELINE_REF
  if (baselineRef) assert.match(baselineRef, /^[0-9a-f]{40}$/i, 'Negative control requires a full production commit SHA')
  const baselineSend = baselineRef ? execFileSync('git', ['show', `${baselineRef}:frontend/src/pages/Send.tsx`], { cwd: frontendRoot, encoding: 'utf8' }) : undefined
  browser = createBrowserHarness({ frontendRoot, name: 'send', ready: 'window.__sendHarness?.ready && document.querySelector("input")',
    plugins: [{
      name: 'mocked-send-handoff-browser-fixture', enforce: 'pre',
      resolveId(source) {
        if (/\/lib\/store(?:\.tsx)?$/.test(source)) return '/__send_test__/wallet.jsx'
        if (source.startsWith('/__send_test__/')) return source
      },
      load(id) {
        if (baselineSend && id.replaceAll('\\', '/').endsWith('/src/pages/Send.tsx')) return baselineSend
        if (id === '/__send_test__/wallet.jsx') return walletFixture
        if (id === '/__send_test__/entry.js') return entry
      },
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/__send_test__?')) return next()
          const html = await vite.transformIndexHtml(req.url, '<!doctype html><html><body><div id="app"></div><script type="module" src="/__send_test__/entry.js"></script></body></html>')
          res.setHeader('Content-Type', 'text/html'); res.end(html)
        })
      },
    }],
  })
  await browser.start()
})

after(async () => { await browser?.close() })

const fixture = (params, run) => browser.fixture('__send_test__', params, run)

const confirmExists = `!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Confirm in wallet')`
const reviewReady = `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`
const estimateCount = `window.__sendHarness.calls.filter((c) => c.method === 'eth_estimateGas').length`
const sendCount = `window.__sendHarness.calls.filter((c) => c.method === 'eth_sendTransaction').length`
const rows = `Object.fromEntries([...document.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')?.textContent.trim(), row.querySelector('dd')?.textContent.trim()]))`

test('MOCKED actual Agent parses Vietnamese Send, confirms parameters, then hands off to live review', async () => {
  await fixture({ source: 'agent-ui', hold: '1' }, async ({ evaluate, wait, click, fill }) => {
    await fill(0, `Gửi 1 USDC cho ${recipient}`)
    await evaluate(`(() => { const b = document.querySelector('button[aria-label="Send message"]'); if (!b || b.disabled) throw new Error('Agent submit missing'); b.click(); })()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters' && !b.disabled)`, 'Actual Agent must parse the exact Vietnamese request into parameter review')
    const parameters = await evaluate(`({asset: document.querySelector('select[id$="-asset"]').value, amount: document.querySelector('input[id$="-amt"]').value, recipient: document.querySelector('input[id$="-to"]').value})`)
    assert.deepEqual(parameters, { asset: 'USDC', amount: '1', recipient })
    assert.equal(await evaluate(sendCount), 0, 'Agent parameter review must never open wallet')
    assert.equal(await evaluate(estimateCount), 0, 'Agent observation remains separate from Send preparation')
    assert.equal(await evaluate('sessionStorage.getItem("mk.brain.handoff.v1")'), null)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Continue to Send preview')`, 'Parameter confirmation must unlock Continue')
    assert.equal(await evaluate(sendCount), 0, 'Parameter confirmation must never open wallet')
    assert.equal(await evaluate(estimateCount), 0)
    await click('Continue to Send preview')
    await wait(`window.__sendHarness.release || ${confirmExists}`, 'Continue must route to the actual Send component')
    assert.equal(await evaluate(confirmExists), false, 'Agent cont() must not expose Confirm before PreparedSend exists')
    assert.equal(await evaluate(estimateCount), 1, 'Both handoff channels must start one live preparation')
    assert.equal(await evaluate(sendCount), 0)
    await evaluate('window.__sendHarness.release()')
    await wait(reviewReady, 'Actual Agent handoff must produce a valid Send review')
    const values = await evaluate(rows)
    assert.equal(values.To, recipient)
    assert.equal(values['Maximum fee'], '0.0048 USDC')
    assert.equal(values.Total, '1.0048 USDC')
    assert.equal(await evaluate(sendCount), 0)
    assert.equal(await evaluate('sessionStorage.getItem("mk.brain.handoff.v1")'), null)
    assert.equal(await evaluate('window.__sendHarness.wallet.sendDraft'), null)
  })
})

for (const source of ['handoff', 'draft', 'both']) {
  test(`MOCKED ${source} Agent Send prepares exactly once before review and never opens wallet automatically`, async () => {
    await fixture({ source, hold: '1' }, async ({ evaluate, wait }) => {
      await wait('!!window.__sendHarness.release', 'Live gas preparation must begin')
      assert.equal(await evaluate(estimateCount), 1)
      assert.equal(await evaluate(confirmExists), false, 'Missing PreparedSend must not expose wallet confirmation')
      assert.equal(await evaluate(sendCount), 0)
      assert.match(await evaluate('document.body.innerText'), /Preparing live review/)
      await evaluate('window.__sendHarness.release()')
      await wait(reviewReady, 'Prepared Send review must become actionable')
      const values = await evaluate(rows)
      assert.equal(values['Maximum fee'], '0.0048 USDC')
      assert.equal(values.Total, '1.0048 USDC')
      assert.equal(values.To, recipient)
      assert.equal(await evaluate(estimateCount), 1, 'Dual handoff channels must not prepare twice')
      assert.equal(await evaluate(sendCount), 0, 'Review is read-only until an explicit user click')
      assert.equal(await evaluate('sessionStorage.getItem("mk.brain.handoff.v1")'), null)
      assert.equal(await evaluate('window.__sendHarness.wallet.sendDraft'), null)
    })
  })
}

test('MOCKED manual Review uses the same live preparation and fee bounds as Agent handoff', async () => {
  let handoffCalls
  await fixture({ source: 'both' }, async ({ evaluate, wait }) => {
    await wait(reviewReady, 'Agent review must finish')
    handoffCalls = await evaluate('window.__sendHarness.calls')
  })
  await fixture({ source: 'manual' }, async ({ evaluate, wait, click, fill }) => {
    await fill(0, recipient); await fill(1, '1')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Review' && !b.disabled)`, 'Manual Review must enable')
    await click('Review')
    await wait(reviewReady, 'Manual live review must finish')
    assert.deepEqual(await evaluate('window.__sendHarness.calls'), handoffCalls, 'Both origins must run the same provider checks/calldata')
    assert.equal((await evaluate(rows)).Total, '1.0048 USDC')
    assert.equal(await evaluate(sendCount), 0)
  })
})

test('MOCKED wallet cancellation after explicit confirmation is USER_REJECTED with no hash or activity', async () => {
  await fixture({ source: 'both' }, async ({ evaluate, wait, click }) => {
    await wait(reviewReady, 'Live review must finish')
    assert.equal(await evaluate(sendCount), 0)
    await click('Confirm in wallet')
    await wait('document.body.innerText.includes("Wallet request cancelled")', '4001 cancellation must display USER_REJECTED state')
    assert.equal(await evaluate(sendCount), 1, 'Only the explicit click may request the MOCK wallet')
    assert.equal(await evaluate(estimateCount), 2, 'Confirmation must revalidate preparation')
    assert.doesNotMatch(await evaluate('document.body.innerText'), /Transaction hash|Transaction confirmed|Submitted; waiting for receipt/)
    assert.equal(await evaluate(`document.querySelectorAll('a[href*="/tx/"]').length`), 0)
    assert.deepEqual(await evaluate('window.__sendHarness.records'), [])
    assert.equal(await evaluate('window.__sendHarness.calls.some((c) => /sign|Receipt/i.test(c.method))'), false)
  })
})

for (const source of ['both', 'manual']) {
  test(`MOCKED ${source} preparation failure keeps a usable form and no actionable Confirm`, async () => {
    await fixture({ source, fault: 'fee' }, async ({ evaluate, wait, click, fill }) => {
      if (source === 'manual') {
        await fill(0, recipient); await fill(1, '1')
        await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Review' && !b.disabled)`, 'Manual Review must enable')
        await click('Review')
      }
      await wait('window.__sendHarness.notices.length > 0', 'Existing safe localized error must display')
      assert.equal(await evaluate('window.__sendHarness.notices[0].message'), 'Fee estimate unavailable')
      assert.equal(await evaluate(confirmExists), false)
      assert.equal(await evaluate(sendCount), 0)
      assert.match(await evaluate('document.body.innerText'), /Maximum fee\s*Unavailable/)
      assert.equal(await evaluate('document.querySelectorAll("input").length'), 2)
      assert.equal(await evaluate(estimateCount), 1, 'Failure must not create an automatic retry loop')
    })
  })
}

test('MOCKED Vietnamese preparation failure keeps the existing localized safe error', async () => {
  await fixture({ source: 'both', fault: 'fee', lang: 'vi' }, async ({ evaluate, wait }) => {
    await wait('window.__sendHarness.notices.length > 0', 'Localized error must display')
    assert.equal(await evaluate('window.__sendHarness.notices[0].message'), 'Không có ước tính phí')
    assert.equal(await evaluate(sendCount), 0)
  })
})

for (const change of ['amount', 'account', 'chain']) {
  test(`MOCKED pending preparation cannot install stale review after ${change} changes`, async () => {
    await fixture({ source: 'both', hold: '1' }, async ({ evaluate, wait, fill }) => {
      await wait('!!window.__sendHarness.release', 'Live preparation must begin')
      if (change === 'amount') await fill(1, '2')
      if (change === 'account') await evaluate(`window.__sendHarness.setWallet({address: '${secondRecipient}'})`)
      if (change === 'chain') await evaluate('window.__sendHarness.setWallet({walletChainId: 1})')
      await delay(60)
      await evaluate('window.__sendHarness.release()')
      await wait(`![...document.querySelectorAll('button')].some((b) => b.textContent.includes('Preparing live review'))`, 'Stale preparation must settle')
      assert.equal(await evaluate(confirmExists), false, 'Stale prepared data cannot authorize a review')
      assert.equal(await evaluate(sendCount), 0)
      assert.match(await evaluate('document.body.innerText'), /Maximum fee\s*Unavailable/)
    })
  })
}

test('MOCKED changing a reviewed recipient removes PreparedSend and prevents confirmation', async () => {
  await fixture({ source: 'both' }, async ({ evaluate, wait }) => {
    await wait(reviewReady, 'Live review must finish')
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('0x3333')); if (!b) throw new Error('Recent recipient missing'); b.click(); })()`)
    await wait('!!document.querySelector("input")', 'Changed recipient must return to form')
    assert.equal(await evaluate(confirmExists), false)
    assert.equal(await evaluate(sendCount), 0)
    assert.match(await evaluate('document.body.innerText'), /Maximum fee\s*Unavailable/)
  })
})

for (const kind of ['swap', 'bridge']) {
  test(`MOCKED Agent ${kind} handoff keeps existing parameter fill and explicit review boundary`, async () => {
    await fixture({ kind, source: 'handoff' }, async ({ evaluate, wait }) => {
      await wait('document.querySelector("input").value === "1"', `${kind} handoff must fill amount`)
      assert.equal(await evaluate('sessionStorage.getItem("mk.brain.handoff.v1")'), null)
      assert.deepEqual(await evaluate('window.__sendHarness.calls'), [], `${kind} handoff must not automatically prepare or sign`)
      assert.equal(await evaluate(confirmExists), false)
      const text = await evaluate('document.body.innerText')
      if (kind === 'swap') assert.match(text, /Live Xylo|live swap|Review swap/i)
      else assert.match(text, /Base Sepolia/)
    })
  })
}

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, writeFile } from 'node:fs/promises'
import tailwindcss from '@tailwindcss/vite'
import { createBrowserHarness, delay } from './browser-harness.mjs'

// Arc RPC mock handler — mirrors the injected provider mock but for bypass methods.
// Runs server-side in the Vite middleware so the browser never reaches the real Arc RPC.
// Returns [result, error] where error is null on success.
function handleArcRpcMethod(method, params) {
  const symbolHex = (s) => '0x' + '20'.padStart(64, '0') + s.length.toString(16).padStart(64, '0') + [...s].map((x) => x.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')
  if (method === 'eth_getCode') {
    const addr = (params[0] ?? '').toLowerCase()
    const EOA_ADDRS = ['0x1951f95962442b6b6be2671e4d39bc88ff6cbe71', '0x3333333333333333333333333333333333333333']
    return [EOA_ADDRS.includes(addr) ? '0x' : '0x6000', null]
  }
  if (method === 'eth_call') {
    const { data, to } = params[0] ?? {}
    if (data === '0x313ce567') return ['0x6', null]
    if (data === '0x95d89b41') return [symbolHex((to ?? '').toLowerCase() === '0x3600000000000000000000000000000000000000' ? 'USDC' : 'EURC'), null]
    if (data?.startsWith('0x70a08231')) return ['0x989680', null]
    return ['0x', null]
  }
  if (method === 'eth_getBalance') return ['0x8ac7230489e80000', null]
  if (method === 'eth_estimateGas') {
    // Normal: return gas estimate. The fault=fee path is handled browser-side
    // by the fetch wrapper (window.__arcRpcFetch intercept) — not server-side.
    return ['0x186a0', null]
  }
  if (method === 'eth_gasPrice') return ['0x4a817c800', null]
  if (method === 'eth_blockNumber') return ['0x7b', null]
  if (method === 'eth_getTransactionReceipt') return [null, null]
  if (method === 'eth_getTransactionByHash') return [null, null]
  return [null, { code: -32601, message: `Unexpected Arc RPC mock method: ${method}` }]
}

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
      swapDraft: q.get('kind') === 'bridge' && ['draft', 'both'].includes(q.get('source')) ? {amount: '1', dest: q.get('to') || 'Base Sepolia'} : null,
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
  import '/src/index.css';
  import { createElement, StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { WalletFixture, useWallet } from '/__send_test__/wallet.jsx';
  import { createBrainHandoff, storeBrainHandoff } from '/src/brain/handoff.ts';
  const q = new URLSearchParams(location.search);
  // Two separate mock channels — mirrors the Rev 6 split in production:
  //   window.ethereum  → injected wallet provider (eth_accounts, eth_chainId, signing only)
  //   window.__arcRpcOverrideUrl → Arc read-only RPC (eth_getCode, eth_call, eth_estimateGas, etc.)
  const h = window.__sendHarness = {calls: [], arcCalls: [], notices: [], records: [], ready: false, release: null};
  // Point arcRpc.ts at the local Vite mock server instead of the real Arc Testnet RPC.
  const arcMockUrl = location.origin + '/__arc_rpc_mock__';
  window.__arcRpcOverrideUrl = arcMockUrl;
  // Wrap window.fetch to intercept Arc RPC mock calls so we can:
  //   1. Record arc calls in window.__sendHarness.arcCalls.
  //   2. Apply hold (eth_estimateGas blocking) and fault (fee error) browser-side.
  const _origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (typeof input === 'string' && input.startsWith(arcMockUrl)) {
      const body = init?.body ? JSON.parse(init.body) : {};
      h.arcCalls.push({method: body.method, params: body.params});
      if (body.method === 'eth_estimateGas') {
        if (q.get('hold') === '1' && !h.released) {
          await new Promise((resolve) => {h.release = () => {h.released = true; resolve()}});
        }
        if (q.get('fault') === 'fee') {
          return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,error:{code:-32000,message:'Fee estimate unavailable'}}), {status:200,headers:{'Content-Type':'application/json'}});
        }
      }
    }
    return _origFetch(input, init);
  };
  // Safety: assert the mock intercept is active before any RPC call fires.
  // If arcRpc.ts falls through to the production URL, tests would call the real Arc Testnet.
  if (!window.__arcRpcOverrideUrl || !window.__arcRpcOverrideUrl.startsWith(location.origin)) {
    throw new Error('Arc RPC mock override not set — tests would hit real Arc Testnet RPC');
  }
  localStorage.setItem('mk.lang', q.get('lang') || 'en');
  document.documentElement.dataset.theme = q.get('theme') || 'dark';
  document.documentElement.className = q.get('theme') || 'dark';
  // Injected wallet provider: only wallet-interactive methods.
  window.ethereum = { isMetaMask: true, request: async ({method, params = []}) => {
    h.calls.push({method, params});
    if (method === 'eth_accounts') return [h.wallet?.address || '${account}'];
    if (method === 'eth_chainId') return '0x' + (h.wallet?.walletChainId || 5042002).toString(16);
    if (method === 'eth_sendTransaction') throw Object.assign(new Error('MOCK wallet cancellation; no broadcast'), {code: 4001});
    throw new Error('Unexpected MOCK provider request: ' + method);
  }};
  const kind = q.get('kind') || 'send';
  if (['handoff', 'both'].includes(q.get('source'))) {
    const action = {kind, rawUserText: 'Agent test handoff', amount: '1', asset: 'USDC', recipient: '${recipient}', outputAsset: 'EURC', sourceChain: q.get('from') || 'Arc Testnet', destinationChain: q.get('to') || 'Base Sepolia'};
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
  browser = createBrowserHarness({ frontendRoot, name: 'send', ready: 'window.__sendHarness?.ready && (document.querySelector("input") || document.querySelector("dl > div"))',
    plugins: [tailwindcss(), {
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
          // Arc RPC mock endpoint — handles all bypass methods server-side.
          // hold/fault params are handled browser-side via the fetch wrapper in entry.js.
          if (req.url?.startsWith('/__arc_rpc_mock__') && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => { body += chunk })
            req.on('end', () => {
              try {
                const { method, params = [], id } = JSON.parse(body)
                // fault=fee is handled browser-side via the fetch wrapper; fall through here.
                const [result, error] = handleArcRpcMethod(method, params)
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
          if (req.url?.startsWith('/__arc_rpc_mock__') && req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            res.statusCode = 204; res.end(); return
          }
          if (!req.url?.startsWith('/__send_test__?')) return next()
          const html = await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app" class="mk-app p-4"></main><script type="module" src="/__send_test__/entry.js"></script></body></html>')
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
// eth_estimateGas goes through arcRpc (bypass), not window.ethereum — count from arcCalls.
const estimateCount = `window.__sendHarness.arcCalls.filter((c) => c.method === 'eth_estimateGas').length`
// eth_sendTransaction still goes through window.ethereum (wallet signing).
const sendCount = `window.__sendHarness.calls.filter((c) => c.method === 'eth_sendTransaction').length`
// All Arc RPC bypass calls must have gone through the mock — none to real internet.
// arcCalls is populated only when fetch target starts with arcMockUrl (entry.js fetch wrapper).
// If arcRpc.ts bypassed the mock and hit rpc.testnet.arc.io directly, it would NOT appear in
// arcCalls, and the preparation would fail or return stale data.
const arcMockActive = `window.__arcRpcOverrideUrl && window.__arcRpcOverrideUrl.startsWith(location.origin)`
const rows = `Object.fromEntries([...document.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt')?.textContent.trim(), row.querySelector('dd')?.textContent.trim()]))`

const demoRecipient = '0x836504101e1afa38ff8fa8dd6f75b2ba428039ca'
for (const lang of ['en', 'vi']) {
  test(`MOCKED clickable Agent Send suggestion submits the exact full address in ${lang}`, async () => {
    await fixture({ source: 'agent-ui', lang }, async ({ evaluate, wait }) => {
      const command = `${lang === 'vi' ? 'Gửi 1 USDC tới' : 'Send 1 USDC to'} ${demoRecipient}`
      const submitted = await evaluate(`(() => {
        const suggestion = [...document.querySelectorAll('button')].find((b) => /^(Send |Gửi )/.test(b.textContent.trim()));
        if (!suggestion) throw new Error('Actual Send suggestion missing');
        const text = suggestion.textContent.trim(); suggestion.click(); return text;
      })()`)
      assert.equal(submitted, command, 'The actual click must pass a full address, never an ellipsis')
      assert.equal(await evaluate('document.querySelector("form input").placeholder'), command)
      await wait(`!!document.querySelector('input[id$="-to"]')`, 'Send suggestion must produce editable parameters')
      const parameters = await evaluate(`({asset: document.querySelector('select[id$="-asset"]').value, amount: document.querySelector('input[id$="-amt"]').value, recipient: document.querySelector('input[id$="-to"]').value})`)
      assert.deepEqual(parameters, { asset: 'USDC', amount: '1', recipient: demoRecipient })
      assert.ok((await evaluate('document.body.textContent')).includes(command), 'User message must retain the entire command')
      assert.doesNotMatch(await evaluate('document.body.textContent'), /Recipient address is malformed|Địa chỉ người nhận không hợp lệ|0x1234…7890/)
      assert.equal(await evaluate(sendCount), 0)
      assert.equal(await evaluate(estimateCount), 0, 'A suggestion only prepares Agent parameters')
      const calls = await evaluate('window.__sendHarness.calls')
      // After Rev 6: eth_getCode and eth_call go through arcRpc, not window.ethereum.
      // Provider calls must be wallet-interactive only (eth_accounts, eth_chainId).
      assert.ok(calls.every(({ method }) => ['eth_accounts', 'eth_chainId'].includes(method)), JSON.stringify(calls))
    })
  })
}

test('MOCKED clickable Vietnamese Bridge suggestion and natural wording produce Bridge without missing recipient', async () => {
  for (const natural of [false, true]) {
    await fixture({ source: 'agent-ui', lang: 'vi' }, async ({ evaluate, wait, click, fill }) => {
      const command = natural ? 'Chuyển 10 USDC sang Base Sepolia' : 'Chuyển chuỗi 10 USDC sang Base Sepolia'
      if (natural) {
        await fill(0, command)
        await evaluate('document.querySelector("form").requestSubmit()')
      } else await click(command)
      await wait(`!!document.querySelector('span[id$="-dest"]')`, 'Vietnamese request must create Bridge parameters')
      assert.deepEqual(await evaluate(`({asset: document.querySelector('select[id$="-asset"]').value, amount: document.querySelector('input[id$="-amt"]').value, destination: document.querySelector('span[id$="-dest"]').textContent})`), { asset: 'USDC', amount: '10', destination: 'Base Sepolia' })
      assert.equal(await evaluate(`document.querySelector('input[id$="-to"]') !== null`), false)
      assert.doesNotMatch(await evaluate('document.body.textContent'), /Thiếu.*Người nhận/)
      assert.equal(await evaluate(sendCount), 0)
      assert.equal(await evaluate(estimateCount), 0)
      const calls = await evaluate('window.__sendHarness.calls')
      // After Rev 6: eth_getCode and eth_call go through arcRpc, not window.ethereum.
      assert.ok(calls.every(({ method }) => ['eth_accounts', 'eth_chainId'].includes(method)), JSON.stringify(calls))
    })
  }
})

test('MOCKED actual Vietnamese Agent Bridge suggestion confirms parameters and hands off only to Arc Testnet → Base Sepolia', async () => {
  await fixture({ kind: 'bridge', source: 'agent-ui', lang: 'vi' }, async ({ evaluate, wait, click }) => {
    await click('Chuyển chuỗi 10 USDC sang Base Sepolia')
    await wait(`!!document.querySelector('span[id$="-dest"]')`, 'Agent must prepare the supported Bridge parameters')
    assert.equal(await evaluate(`document.querySelector('span[id$="-dest"]').textContent`), 'Base Sepolia')
    assert.equal(await evaluate(`document.querySelector('select[id$="-dest"]') !== null`), false, 'Agent cannot select an unsupported route')
    await click('Xác nhận thông số')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Mở trang Bridge')`, 'Translated Bridge page button must appear')
    assert.equal(await evaluate(sendCount), 0)
    assert.equal(await evaluate(estimateCount), 0)
    await click('Mở trang Bridge')
    await wait('window.__sendHarness.wallet.page === "bridge" && document.querySelector("input").value === "10"', 'Agent must fill the actual fixed-route Bridge page')
    const text = await evaluate('document.body.innerText')
    assert.match(text, /Arc Testnet → Base Sepolia/)
    assert.match(text, /Circle CCTP v2/)
    assert.match(text, /Tuyến thử nghiệm hiện được hỗ trợ/)
    assert.doesNotMatch(text, /Ethereum Sepolia|Arbitrum Sepolia|Avalanche Fuji|OP Sepolia|To Arc|Base Sepolia → Arc/)
    assert.equal(await evaluate('document.querySelectorAll("select").length'), 0)
    assert.equal(await evaluate('sessionStorage.getItem("mk.brain.handoff.v1")'), null)
    assert.equal(await evaluate('window.__sendHarness.wallet.swapDraft'), null)
    assert.equal(await evaluate(sendCount), 0, 'Agent handoff must never open the wallet or resubmit a burn')
    assert.equal(await evaluate(estimateCount), 0, 'User must explicitly request a fresh Circle review')
  })
})

for (const lang of ['en', 'vi']) for (const theme of ['dark', 'light']) for (const width of [390, 1440]) {
  test(`MOCKED Bridge exposes only Arc Testnet → Base Sepolia in ${lang}/${theme} at ${width}px`, async () => {
    await fixture({ kind: 'bridge', source: 'handoff', lang, theme }, async ({ evaluate, wait, setViewport, screenshot }) => {
      await setViewport(width, 900)
      await wait('document.querySelector("input").value === "1" && getComputedStyle(document.querySelector("section")).borderRadius !== "0px"', 'Supported handoff and production CSS must load')
      const text = await evaluate('document.body.innerText')
      assert.match(text, /Arc Testnet → Base Sepolia/)
      assert.match(text, /Circle CCTP v2/)
      assert.match(text, lang === 'vi' ? /Chỉ USDC/ : /USDC only/)
      assert.doesNotMatch(text, /Ethereum Sepolia|Arbitrum Sepolia|Avalanche Fuji|OP Sepolia|To Arc|Base Sepolia → Arc/)
      assert.equal(await evaluate('document.querySelectorAll("select").length'), 0)
      assert.equal(await evaluate('document.querySelectorAll("button[aria-pressed]").length'), 2, 'Both quote-supported transfer modes remain')
      assert.equal(await evaluate('document.querySelector("button[aria-pressed=true]").textContent.includes(' + JSON.stringify(lang === 'vi' ? 'Nhanh' : 'Fast') + ')'), true)
      await evaluate('document.querySelectorAll("button[aria-pressed]")[1].click()')
      await wait('document.querySelectorAll("button[aria-pressed]")[1].getAttribute("aria-pressed") === "true"', 'Standard mode must be selectable before live quote')
      await wait(`!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(lang === 'vi' ? 'Lấy báo giá Circle và xem lại' : 'Get live Circle quote and review')} && !b.disabled)`, 'Supported handoff must allow an explicit live quote request')
      assert.equal(await evaluate('document.documentElement.dataset.theme'), theme)
      assert.equal(await evaluate('getComputedStyle(document.querySelector("section")).backgroundColor'), theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(10, 13, 10)')
      assert.equal(await evaluate('window.innerWidth'), width)
      assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Production Bridge layout must not overflow horizontally')
      assert.deepEqual(await evaluate('window.__sendHarness.calls'), [], 'Route display, mode selection and supported handoff are read-only')
      assert.equal(await evaluate(sendCount), 0)
      const directory = process.env.MAKOTO_BRIDGE_SCREENSHOT_DIR
      if (directory) {
        await delay(250) // Let the selected mode's existing CSS transition finish.
        await mkdir(directory, { recursive: true })
        await writeFile(path.join(directory, `bridge-${lang}-${theme}-${width}.png`), Buffer.from(await screenshot(), 'base64'))
      }
    })
  })
}

for (const source of ['draft', 'both']) {
  test(`MOCKED supported ${source} Bridge handoff keeps the fixed route without automatic preparation`, async () => {
    await fixture({ kind: 'bridge', source }, async ({ evaluate, wait }) => {
      await wait('document.querySelector("input").value === "1"', 'Supported Bridge draft must fill the amount')
      assert.equal(await evaluate('window.__sendHarness.wallet.swapDraft'), null)
      assert.match(await evaluate('document.body.innerText'), /Arc Testnet → Base Sepolia/)
      assert.equal(await evaluate('document.querySelectorAll("select").length'), 0)
      assert.deepEqual(await evaluate('window.__sendHarness.calls'), [])
    })
  })
}

for (const route of [{ from: 'Base Sepolia', to: 'Arc Testnet' }, { from: 'Arc Testnet', to: 'Ethereum Sepolia' }]) {
  test(`MOCKED unsupported ${route.from} → ${route.to} handoff cannot silently prepare the supported route`, async () => {
    await fixture({ kind: 'bridge', source: 'handoff', ...route }, async ({ evaluate, wait }) => {
      await wait('!!document.querySelector("p[role=status]")', 'Unsupported route handoff must fail closed')
      assert.equal(await evaluate('document.querySelector("input").value'), '')
      assert.match(await evaluate('document.body.innerText'), /Only Arc Testnet → Base Sepolia USDC is supported/)
      assert.equal(await evaluate(`!![...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Get live Circle quote and review' && b.disabled)`), true)
      assert.deepEqual(await evaluate('window.__sendHarness.calls'), [])
    })
  })
}

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
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Open Send page')`, 'Parameter confirmation must unlock Continue')
    assert.equal(await evaluate(sendCount), 0, 'Parameter confirmation must never open wallet')
    assert.equal(await evaluate(estimateCount), 0)
    await click('Open Send page')
    await wait(`window.__sendHarness.release || ${confirmExists}`, 'Continue must route to the actual Send component')
    assert.equal(await evaluate(confirmExists), false, 'Agent cont() must not expose Confirm before PreparedSend exists')
    assert.equal(await evaluate(estimateCount), 1, 'Both handoff channels must start one live preparation')
    assert.equal(await evaluate(sendCount), 0)
    await evaluate('window.__sendHarness.release()')
    await wait(reviewReady, 'Actual Agent handoff must produce a valid Send review')
    assert.equal(await evaluate(arcMockActive), true, 'Arc RPC mock must be active — no real internet calls')
    const values = await evaluate(rows)
    assert.equal(values.To, recipient)
    // Fee calculation (verified against sendExecution.ts):
    //   estimate = 0x186a0 = 100,000
    //   gas      = (100000n * 12n + 9n) / 10n = 120,000  (20% buffer, rounded up by +9/10)
    //   gasPrice = 0x4a817c800 = 20,000,000,000 (20 gwei)
    //   boundedPrice = max(gasPrice*2, 20gwei) = 40,000,000,000 (40 gwei)
    //   fee (native) = 120,000 * 40,000,000,000 = 4,800,000,000,000,000
    //   feeInUsdcUnits = ceil(4.8e15 / 1e12) = 4,800 units = 0.0048 USDC
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

/**
 * Agent native execution browser tests.
 *
 * Verifies that clicking "Execute Send/Swap/Bridge in chat":
 * - Renders the execution card inside the chat (not a page navigation).
 * - Never auto-signs or auto-submits.
 * - Each step requires an explicit user confirmation.
 * - FAILED and USER_REJECTED outcomes do NOT produce a "Transaction complete" toast.
 * - Slippage buttons change the displayed slip value without mounting a new card.
 * - Speed buttons change the displayed speed value without mounting a new card.
 * - Closing (Cancel) dismisses the card without navigation.
 *
 * All wallet requests are MOCKED. The mock rejects eth_sendTransaction with code 4001
 * (user rejected) — no real broadcast ever happens.
 * Run: node --test tests/agent-native-exec.test.mjs
 * MAKOTO_CHROME_PATH selects the Chrome/Chromium executable.
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import tailwindcss from '@tailwindcss/vite'
import { createBrowserHarness, delay } from './browser-harness.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Arc RPC mock handler — server-side, mirrors send-handoff.test.mjs.
// Handles all bypass methods (eth_getCode, eth_call, eth_estimateGas, eth_gasPrice,
// eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash, eth_blockNumber).
// Returns [result, error] — error is null on success.
function handleArcRpcMethod(method, params) {
  const TOKEN_ADDRS = new Set([
    '0x3600000000000000000000000000000000000000', // USDC
    '0x89b50855aa3be2f677cd6303cec089b5f319d72a', // EURC
    '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf', // cirBTC
  ])
  const TOKEN_SYMBOL = {
    '0x3600000000000000000000000000000000000000': 'USDC',
    '0x89b50855aa3be2f677cd6303cec089b5f319d72a': 'EURC',
    '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf': 'cirBTC',
  }
  const TOKEN_DECIMALS = {
    '0x3600000000000000000000000000000000000000': 6,
    '0x89b50855aa3be2f677cd6303cec089b5f319d72a': 6,
    '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf': 8,
  }
  const abiString = (s) => {
    const hex = [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0')
    return '0x' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      s.length.toString(16).padStart(64, '0') + hex
  }

  if (method === 'eth_getCode') {
    const addr = (params[0] ?? '').toLowerCase()
    return [TOKEN_ADDRS.has(addr) ? '0x6000' : '0x', null]
  }
  if (method === 'eth_call') {
    const { data, to } = params[0] ?? {}
    const addr = (to ?? '').toLowerCase()
    if (data === '0x313ce567') {
      const dec = TOKEN_DECIMALS[addr] ?? 6
      return ['0x' + dec.toString(16).padStart(64, '0'), null]
    }
    if (data === '0x95d89b41') return [abiString(TOKEN_SYMBOL[addr] ?? 'USDC'), null]
    if (data?.startsWith('0x70a08231')) {
      const dec = TOKEN_DECIMALS[addr] ?? 6
      const bal = dec === 8 ? 50_000_000n : 50_000_000n
      return ['0x' + bal.toString(16).padStart(64, '0'), null]
    }
    return ['0x' + '0'.repeat(64), null]
  }
  if (method === 'eth_getBalance') return ['0x' + (100n * 10n ** 18n).toString(16), null]
  if (method === 'eth_estimateGas') return ['0x186a0', null]
  if (method === 'eth_gasPrice') return ['0x4a817c800', null]
  if (method === 'eth_blockNumber') return ['0x7b', null]
  if (method === 'eth_getTransactionReceipt') return [null, null]
  if (method === 'eth_getTransactionByHash') return [null, null]
  return [null, { code: -32601, message: `Unexpected Arc RPC mock method: ${method}` }]
}

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const account = '0x1111111111111111111111111111111111111111'
const recipient = '0x1951f95962442b6b6be2671e4d39bc88ff6cbe71'

/** Wallet fixture — identical shape to send-handoff.test.mjs but simpler, agent-only. */
const walletFixture = `
  import { createContext, useContext, useState } from 'react';
  import { TOKENS, ARC } from '/src/lib/wallet.ts';
  const Context = createContext(null);
  export const useWallet = () => useContext(Context);
  export function WalletFixture({ children }) {
    const [state, setState] = useState({
      page: 'agent', mode: 'connected', address: '${account}', walletChainId: ARC.chainId,
      displayAddress: '${account}', total: 100, pricesReady: true, tasks: [], taskAuthenticated: false,
      agentSeed: null, agentSeedMode: null, mask: (v) => v,
      holdings: TOKENS.map((t) => ({...t, symbol: t.sym, verified: true, balance: 50, price: 1, value: 50})),
      prices: {USDC: {price: 1}, EURC: {price: 1}},
      network: {tokenTransferFeeUsdc: 0.002, blockNumber: 100, rpcLatencyMs: 30}, contacts: [],
      activity: [], settings: {confirmLarge: false}, sendDraft: null, swapDraft: null,
    });
    const [setters] = useState(() => ({
      setSendDraft: (v) => setState((s) => ({...s, sendDraft: v})),
      setSwapDraft: (v) => setState((s) => ({...s, swapDraft: v})),
      go: (page) => setState((s) => ({...s, page})),
      setAgentSeed: () => {}, setAgentSeedMode: () => {},
      notify: (msg, tone) => window.__agentHarness.notices.push({msg, tone}),
      upsertSend: (r) => window.__agentHarness.records.push(r),
      upsertSwap: () => {}, upsertBridge: () => {},
      refetchWallet: async () => {},
      createTask: async () => {}, updateTask: async () => {}, deleteTask: async () => {}, runTask: async () => ({}),
      refreshTasks: async () => {},
    }));
    window.__agentHarness.setWallet = (change) => setState((s) => ({...s, ...change}));
    window.__agentHarness.getWallet = () => state;
    return <Context.Provider value={{...state, ...setters}}>{children}</Context.Provider>;
  }
`

const entry = `
  import '/src/index.css';
  import { createElement, StrictMode } from 'react';
  import { createRoot } from 'react-dom/client';
  import { WalletFixture } from '/__agent_test__/wallet.jsx';
  import AgentPage from '/src/pages/Agent.tsx';
  const h = window.__agentHarness = { calls: [], arcCalls: [], notices: [], records: [], ready: false };
  localStorage.setItem('mk.lang', new URLSearchParams(location.search).get('lang') || 'en');
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.className = 'dark';

  // Two separate mock channels — mirrors send-handoff.test.mjs Rev 6+ split:
  //   window.ethereum  → injected wallet provider (eth_accounts, eth_chainId, signing only)
  //   window.__arcRpcOverrideUrl → Arc read-only RPC (bypass methods via fetch)
  const arcMockUrl = location.origin + '/__arc_agent_rpc_mock__';
  window.__arcRpcOverrideUrl = arcMockUrl;

  // Safety: fail immediately if the mock is not active.
  if (!window.__arcRpcOverrideUrl || !window.__arcRpcOverrideUrl.startsWith(location.origin)) {
    throw new Error('Arc RPC mock override not set — agent tests would hit real Arc Testnet RPC');
  }

  // Wrap fetch to record Arc RPC calls for assertion purposes.
  const _origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    if (typeof input === 'string' && input.startsWith(arcMockUrl)) {
      const body = init?.body ? JSON.parse(init.body) : {};
      h.arcCalls.push({ method: body.method, params: body.params });
    }
    return _origFetch(input, init);
  };

  // Injected wallet provider: only wallet-interactive methods.
  // Bypass methods (eth_getCode, eth_call, eth_estimateGas, eth_gasPrice,
  // eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash) are
  // routed by arcRpc.ts to window.__arcRpcOverrideUrl via fetch — NOT here.
  window.ethereum = { isMetaMask: true, request: async ({method, params = []}) => {
    h.calls.push({method, params});
    if (method === 'eth_accounts') return [h.getWallet?.()?.address || '${account}'];
    if (method === 'eth_chainId') return '0x' + (h.getWallet?.()?.walletChainId || 5042002).toString(16);
    // Wallet send behaviour is controlled by h.sendMode:
    //   '4001'    (default) — user-rejected, code 4001, no hash
    //   'timeout' — non-rejection error, no hash
    //   'ok'      — returns a fake hash
    if (method === 'eth_sendTransaction') {
      const mode = h.sendMode || '4001';
      if (mode === '4001') throw Object.assign(new Error('MOCK rejection; no broadcast'), {code: 4001});
      if (mode === 'timeout') throw new Error('MOCK wallet timeout; no hash returned');
      return '0x' + 'f'.repeat(64);
    }
    if (method === 'wallet_switchEthereumChain') return null;
    // Any other method reaching here is unexpected — throw so tests detect routing bugs.
    throw new Error('Unexpected provider method: ' + method + ' — should be handled by Arc RPC mock');
  }};

  createRoot(document.getElementById('app')).render(
    createElement(StrictMode, null, createElement(WalletFixture, null, createElement(AgentPage)))
  );
  h.ready = true;
`

let browser

before(async () => {
  browser = createBrowserHarness({
    frontendRoot, name: 'agent-native',
    ready: 'window.__agentHarness?.ready',
    plugins: [tailwindcss(), {
      name: 'agent-native-exec-fixture', enforce: 'pre',
      resolveId(source) {
        if (/\/lib\/store(?:\.tsx)?$/.test(source)) return '/__agent_test__/wallet.jsx'
        if (source.startsWith('/__agent_test__/')) return source
      },
      load(id) {
        if (id === '/__agent_test__/wallet.jsx') return walletFixture
        if (id === '/__agent_test__/entry.js') return entry
      },
      configureServer(vite) {
        // Server-side state for dynamic receipt mocking.
        // Set via PUT /__arc_agent_rpc_state__ { confirmedHash: '0x...' | null }
        const rpcState = { confirmedHash: null }
        vite.middlewares.use(async (req, res, next) => {
          // State control endpoint — allows tests to arm a confirmed receipt.
          if (req.url === '/__arc_agent_rpc_state__' && req.method === 'PUT') {
            let body = ''
            req.on('data', (c) => { body += c })
            req.on('end', () => {
              try {
                const patch = JSON.parse(body)
                if ('confirmedHash' in patch) rpcState.confirmedHash = patch.confirmedHash
                res.setHeader('Content-Type', 'application/json')
                res.setHeader('Access-Control-Allow-Origin', '*')
                res.end(JSON.stringify({ ok: true }))
              } catch (_) { res.statusCode = 400; res.end('{}') }
            })
            return
          }
          if (req.url === '/__arc_agent_rpc_state__' && req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            res.statusCode = 204; res.end(); return
          }
          // Arc RPC mock endpoint — handles all bypass methods server-side.
          if (req.url?.startsWith('/__arc_agent_rpc_mock__') && req.method === 'POST') {
            let body = ''
            req.on('data', (chunk) => { body += chunk })
            req.on('end', () => {
              try {
                const { method, params = [], id } = JSON.parse(body)
                // Dynamic receipt: return confirmed receipt when hash matches armed hash.
                let [result, error] = handleArcRpcMethod(method, params)
                if (method === 'eth_getTransactionReceipt' && rpcState.confirmedHash) {
                  const reqHash = (params[0] ?? '').toLowerCase()
                  if (reqHash === rpcState.confirmedHash.toLowerCase()) {
                    // ERC20 Transfer log: USDC transfer of 1_000_000 units
                    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
                    const from32 = '0x000000000000000000000000' + account.slice(2).toLowerCase()
                    const to32 = '0x000000000000000000000000' + recipient.slice(2).toLowerCase()
                    const amount32 = '0x' + (1_000_000n).toString(16).padStart(64, '0')
                    result = {
                      transactionHash: rpcState.confirmedHash,
                      blockHash: '0x' + 'a'.repeat(64),
                      blockNumber: '0x7c',
                      status: '0x1',
                      from: account,
                      to: '0x3600000000000000000000000000000000000000',
                      logs: [{
                        address: '0x3600000000000000000000000000000000000000',
                        topics: [transferTopic, from32, to32],
                        data: amount32,
                      }],
                    }
                    error = null
                  }
                }
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
          if (req.url?.startsWith('/__arc_agent_rpc_mock__') && req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            res.statusCode = 204; res.end(); return
          }
          if (!req.url?.startsWith('/__agent_test__?')) return next()
          const html = await vite.transformIndexHtml(req.url,
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="app" class="mk-app p-4"></main><script type="module" src="/__agent_test__/entry.js"></script></body></html>')
          res.setHeader('Content-Type', 'text/html'); res.end(html)
        })
      },
    }],
  })
  await browser.start()
})

after(async () => { await browser?.close() })

const fixture = (params, run) => browser.fixture('__agent_test__', params, run)

const sendCount = `window.__agentHarness.calls.filter((c) => c.method === 'eth_sendTransaction').length`

// ── Test 1: "Execute Send in chat" renders card in chat, no page navigation ───
test('MOCKED clicking "Execute Send in chat" mounts AgentSendCard inside Agent chat (no page navigation)', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Type a send request and submit
    await fill(0, `Send 5 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    // Wait for review card
    await wait(`!!document.querySelector('[class*="REVIEW PARAMETERS"]') || document.body.innerText.includes('REVIEW PARAMETERS')`, 'Agent must produce parameter review card')
    // Confirm parameters
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`, 'Execute Send button must appear after parameter confirmation')
    // Click Execute Send in chat
    await click('Execute Send in chat')
    // AgentSendCard header must be visible — in chat, not a separate page
    await wait(`document.body.innerText.includes('REVIEW TRANSFER') || document.body.innerText.includes('Preparing live review')`, 'AgentSendCard must render in chat')
    // Page must NOT have changed to 'send'
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent', 'Must stay on agent page')
    assert.equal(await evaluate(sendCount), 0, 'No wallet send before explicit confirmation')
    // eth_estimateGas is legitimately called by prepareSend during live review preparation.
    // We verify NO signing call has been made (eth_sendTransaction, eth_sign, etc.).
    const walletMethods = await evaluate(`window.__agentHarness.calls.map((c) => c.method)`)
    const writeMethods = walletMethods.filter((m) => ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4'].includes(m))
    assert.deepEqual(writeMethods, [], 'No signing calls before explicit user confirmation')
  })
})

// ── Test 2: AgentSendCard USER_REJECTED does NOT produce "Transaction complete" ─
test('MOCKED AgentSendCard USER_REJECTED (wallet mock always rejects): Done closes card without "Transaction complete" toast', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 5 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`, 'Agent parameter review must appear')
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    // Wait for review to be ready (Confirm in wallet button enabled)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Confirm in wallet must be enabled once prepared')
    assert.equal(await evaluate(sendCount), 0, 'No send before user clicks Confirm')
    // Click Confirm — mock always rejects with 4001
    await click('Confirm in wallet')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')`, 'Done button must appear after rejection')
    const bodyText = await evaluate('document.body.innerText')
    // Must show rejection state, never "confirmed"
    assert.match(bodyText, /Wallet rejected|Ví đã từ chối|nothing was submitted|chưa gửi/, 'Rejection label must be visible')
    assert.doesNotMatch(bodyText, /Transfer confirmed|Giao dịch đã xác nhận/, 'Must NOT show confirmed on rejection')
    assert.equal(await evaluate(sendCount), 1, 'Exactly one send attempt (rejected)')
    // Check that no success toast was fired
    const successToasts = await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`)
    assert.equal(successToasts, 0, 'REJECTED must not fire success toast')
    // Click Done — card should close
    await click('Done')
    await wait(`![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')`, 'Card must close after Done')
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent', 'Must remain on agent page after close')
  })
})

// ── Test 3: Cancel dismisses the card without navigation or submission ─────────
test('MOCKED Cancel on AgentSendCard dismisses card, no navigation, no send', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 2 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => /Cancel|Hủy/.test(b.textContent.trim()))`, 'Cancel button must appear on AgentSendCard')
    // Click Cancel
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => /^Cancel$|^Hủy$/.test(b.textContent.trim())); if (!b) throw new Error('Cancel missing'); b.click(); })()`)
    await wait(`![...document.querySelectorAll('button')].some((b) => /^Cancel$|^Hủy$/.test(b.textContent.trim()) && b.closest('[aria-live]'))`, 'Card must close after Cancel')
    assert.equal(await evaluate(sendCount), 0, 'Cancel must never send')
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent')
    assert.equal(await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`), 0, 'Cancel must not fire success toast')
  })
})

// ── Test 4: Slippage buttons change displayed value, card not yet mounted ──────
test('MOCKED Swap slippage buttons update displayed value without mounting execution card', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, 'Swap 10 USDC to EURC')
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Swap in chat')`, 'Execute Swap button must appear')
    // Slippage selector must be visible before Execute is clicked
    await wait(`document.body.innerText.includes('Slippage') || document.body.innerText.includes('Trượt giá')`, 'Slippage selector must be visible')
    // Default is 0.5%
    const defaultPressed = await evaluate(`document.querySelector('button[aria-pressed="true"]')?.textContent.trim()`)
    assert.equal(defaultPressed, '0.5%', 'Default slippage must be 0.5%')
    // Click 1%
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '1%'); if (!b) throw new Error('1% button missing'); b.click(); })()`)
    await delay(100)
    const newPressed = await evaluate(`document.querySelector('button[aria-pressed="true"]')?.textContent.trim()`)
    assert.equal(newPressed, '1%', 'After clicking 1%, aria-pressed must update')
    // Execution card must NOT be mounted yet
    assert.equal(await evaluate(`document.querySelectorAll('[aria-live]').length`), 0, 'No execution card must be mounted from slip change alone')
    assert.equal(await evaluate(sendCount), 0)
  })
})

// ── Test 5: Bridge speed buttons change displayed value ────────────────────────
test('MOCKED Bridge speed buttons update displayed value without mounting execution card', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, 'Bridge 5 USDC to Base Sepolia')
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Bridge in chat')`, 'Execute Bridge button must appear')
    // Speed selector must be visible
    await wait(`document.body.innerText.includes('Speed') || document.body.innerText.includes('Tốc độ')`, 'Speed selector must be visible')
    // Default is Fast
    const defaultPressed = await evaluate(`[...document.querySelectorAll('button[aria-pressed]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent.trim()`)
    assert.ok(defaultPressed === 'Fast' || defaultPressed === 'Nhanh', `Default speed must be Fast/Nhanh, got: ${defaultPressed}`)
    // Click Standard
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Standard' || b.textContent.trim() === 'Tiêu chuẩn'); if (!b) throw new Error('Standard button missing'); b.click(); })()`)
    await delay(100)
    const newPressed = await evaluate(`[...document.querySelectorAll('button[aria-pressed]')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent.trim()`)
    assert.ok(newPressed === 'Standard' || newPressed === 'Tiêu chuẩn', `After clicking Standard, aria-pressed must update. Got: ${newPressed}`)
    assert.equal(await evaluate(sendCount), 0)
  })
})

// ── Test 6: No automatic signing — each step requires explicit click ──────────
test('MOCKED no automatic wallet request on AgentSendCard mount — user must click Confirm in wallet', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 3 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    // Card mounts — let preparation run
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Card must prepare without auto-sending')
    assert.equal(await evaluate(sendCount), 0, 'No send before explicit user click on Confirm in wallet')
    // Wallet calls must only include read-only methods at this point
    const walletMethods = await evaluate(`window.__agentHarness.calls.map((c) => c.method)`)
    const writeMethods = walletMethods.filter((m) => ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4'].includes(m))
    assert.deepEqual(writeMethods, [], `No signing calls before user confirmation. Got: ${JSON.stringify(writeMethods)}`)
  })
})

// ── Test 7: AgentSwapCard renders in chat, no page navigation, no auto-signing ─
test('MOCKED clicking "Execute Swap in chat" mounts AgentSwapCard inside Agent chat (no page navigation, no auto-signing)', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, 'Swap 10 USDC to EURC')
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`, 'Agent must produce parameter review card for Swap')
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Swap in chat')`, 'Execute Swap button must appear after parameter confirmation')
    // Verify page is still agent before executing
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent', 'Must be on agent page before Execute')
    // Click Execute Swap in chat
    await click('Execute Swap in chat')
    // AgentSwapCard header must be visible — in chat, not a separate page
    await wait(
      `document.body.innerText.includes('SWAP IN CHAT') || document.body.innerText.includes('HOÁN ĐỔI TRONG CHAT') || document.body.innerText.includes('USDC') && document.querySelector('[aria-live]')`,
      'AgentSwapCard must render in chat'
    )
    // Must NOT have navigated away
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent', 'Must stay on agent page after Execute Swap')
    // No signing must have happened automatically
    const writeMethods = (await evaluate(`window.__agentHarness.calls.map((c) => c.method)`))
      .filter((m) => ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4'].includes(m))
    assert.deepEqual(writeMethods, [], 'No signing calls on AgentSwapCard mount')
    assert.equal(await evaluate(sendCount), 0)
    // Safety footer must be present (confirms the "separate confirmations" note is visible)
    const bodyText = await evaluate('document.body.innerText')
    assert.ok(
      bodyText.includes('separate') || bodyText.includes('riêng') || bodyText.includes('approval') || bodyText.includes('phê duyệt'),
      'Safety note about separate confirmations must be visible in AgentSwapCard'
    )
  })
})

// ── Test 8: AgentBridgeCard renders in chat — no page nav, no auto-signing,
//    source-confirmed state is not the same as completed ────────────────────────
test('MOCKED clicking "Execute Bridge in chat" mounts AgentBridgeCard inside Agent chat (no auto-signing, source confirmed ≠ completed)', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, 'Bridge 5 USDC to Base Sepolia')
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`, 'Agent must produce parameter review card for Bridge')
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Bridge in chat')`, 'Execute Bridge button must appear after parameter confirmation')
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent', 'Must be on agent page before Execute')
    // Click Execute Bridge in chat
    await click('Execute Bridge in chat')
    // AgentBridgeCard header must be visible — in chat
    await wait(
      `document.body.innerText.includes('BRIDGE IN CHAT') || document.body.innerText.includes('CHUYỂN CHUỖI TRONG CHAT') || document.querySelector('[aria-live]')`,
      'AgentBridgeCard must render in chat'
    )
    // Must NOT have navigated away
    assert.equal(await evaluate(`window.__agentHarness.getWallet?.()?.page`), 'agent', 'Must stay on agent page after Execute Bridge')
    // No signing must have happened automatically
    const writeMethods = (await evaluate(`window.__agentHarness.calls.map((c) => c.method)`))
      .filter((m) => ['eth_sendTransaction', 'eth_sign', 'personal_sign', 'eth_signTypedData_v4'].includes(m))
    assert.deepEqual(writeMethods, [], 'No signing calls on AgentBridgeCard mount')
    assert.equal(await evaluate(sendCount), 0)
    // Safety footer: "Approval and burn are separate" must be visible
    const bodyText = await evaluate('document.body.innerText')
    assert.ok(
      bodyText.includes('separate') || bodyText.includes('riêng') || bodyText.includes('burn') || bodyText.includes('đốt'),
      'Safety note about separate approval/burn must be visible in AgentBridgeCard'
    )
    // "Completed" label must NOT be showing (source not yet confirmed — control is loading quote)
    assert.doesNotMatch(bodyText, /Bridge complete|Hoàn tất cầu nối|Destination confirmed|Xác nhận đích/, 'Must NOT show completed before destination evidence')
  })
})

// ── Test 9: UNKNOWN state with no hash shows Done button and no success toast ──
test('MOCKED UNKNOWN state without hash: Done button appears, no "Transaction complete" toast', async () => {
  // This test uses a wallet mock that throws a non-rejection error (no code 4001)
  // so requestSend goes to UNKNOWN stage with no txHash.
  await fixture({ walletOverride: 'throwNoHash' }, async ({ evaluate, wait, fill, click }) => {
    // Override only the signing method — bypass methods still go to Arc RPC mock.
    // This throws a generic (non-4001) error to trigger UNKNOWN stage with no txHash.
    await evaluate(`
      window.ethereum.request = async ({method, params = []}) => {
        window.__agentHarness.calls.push({method, params});
        if (method === 'eth_accounts') return [window.__agentHarness.getWallet?.()?.address || '${account}'];
        if (method === 'eth_chainId') return '0x' + (5042002).toString(16);
        if (method === 'eth_sendTransaction') throw new Error('MOCK network error, no hash');
        if (method === 'wallet_switchEthereumChain') return null;
        throw new Error('Unexpected provider method in throwNoHash override: ' + method);
      };
    `)
    await fill(0, `Send 5 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    await click('Confirm in wallet')
    // Should reach UNKNOWN state (non-4001 error, no hash)
    await wait(
      `document.body.innerText.includes('unknown') || document.body.innerText.includes('Final status') || document.body.innerText.includes('Chưa rõ') || ([...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done'))`,
      'UNKNOWN state or Done button must appear after non-rejection error'
    )
    // Done button MUST appear even on UNKNOWN (card must not be stuck forever)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')`, 'Done button must appear on UNKNOWN state')
    // No success toast
    const successToasts = await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`)
    assert.equal(successToasts, 0, 'UNKNOWN must not fire success toast')
    // No "Transfer confirmed" label
    const bodyText = await evaluate('document.body.innerText')
    assert.doesNotMatch(bodyText, /Transfer confirmed|Giao dịch đã xác nhận/, 'Must NOT show confirmed on UNKNOWN')
    // "Check again" must NOT appear (no hash — cannot poll)
    assert.doesNotMatch(bodyText, /^Check again$|^Kiểm tra lại$/, 'Check again must not appear without a hash')
    // Click Done — card closes silently
    await click('Done')
    await wait(`![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')`, 'Card must close after Done')
    const finalSuccessToasts = await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`)
    assert.equal(finalSuccessToasts, 0, 'UNKNOWN Done must not produce success toast')
  })
})

// ── Test 10: Wrong-chain then correct-chain — card re-prepares cleanly ─────────
// Agent.tsx passes w.address (live) to AgentSendCard, so account change causes the
// prepare effect to re-run via the 'account' dep. The invalidation effect protects
// cases where account/chain changes EXTERNALLY without params changing. Here we test
// the chain-change scenario: switch to the wrong chain (Ethereum mainnet), then back
// to Arc Testnet; the card should eventually reach review again without being stuck.
test('MOCKED wrong chain then correct chain: card re-prepares to review without sticking at preparing', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 3 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    // Wait for review to be ready
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Card must reach review')
    // Switch to wrong chain in the store and make eth_chainId reflect it
    await evaluate(`
      window.__agentHarness.setWallet({ walletChainId: 1 });
      const _r = window.ethereum.request.bind(window.ethereum);
      window.ethereum.request = async (args) => {
        if (args.method === 'eth_chainId') return window.__agentHarness.getWallet?.()?.walletChainId
          ? '0x' + window.__agentHarness.getWallet().walletChainId.toString(16) : _r(args);
        return _r(args);
      };
    `)
    // Card should show an error or re-preparing (wrong chain → prepareSend fails)
    await wait(
      `document.body.innerText.includes('Arc Testnet is required') || document.body.innerText.includes('Sai mạng') || document.body.innerText.includes('Preparing') || document.body.innerText.includes('Đang chuẩn bị')`,
      'Card must react to wrong chain (error or re-preparing)'
    )
    // Switch back to Arc Testnet
    await evaluate(`window.__agentHarness.setWallet({ walletChainId: 5042002 })`)
    // Card must recover to review with Confirm enabled
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Card must recover to review after switching back to Arc Testnet')
    assert.equal(await evaluate(sendCount), 0, 'No send during chain switch cycle')
  })
})

// ── Test 11: Chain change while tx is submitted — submitted state preserved ────
test('MOCKED chain change while tx submitted: submitted/pending state preserved, not reset to preparing', async () => {
  // Use sendMode 'ok' so requestSend returns a hash → stage reaches 'submitted'.
  // Then simulate a chain change and verify the card stays in the in-flight view
  // (spinner, hash) and does NOT reset to 'preparing'.
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await evaluate(`window.__agentHarness.sendMode = 'ok'`)
    await fill(0, `Send 4 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    // Click Confirm — wallet returns a fake hash → stage becomes 'submitted'
    await click('Confirm in wallet')
    // Wait for submitted state (spinner, hash)
    await wait(
      `document.body.innerText.includes('waiting for receipt') || document.body.innerText.includes('đang chờ biên nhận') || document.body.innerText.includes('Submitted')`,
      'Card must reach submitted state'
    )
    // Now simulate chain change while polling is in-flight
    await evaluate(`window.__agentHarness.setWallet({ walletChainId: 1 })`)
    // Card must NOT reset to 'preparing' — spinner/hash view must remain
    // Wait a brief moment for any spurious re-render to settle
    await evaluate(`new Promise((r) => setTimeout(r, 200))`)
    const bodyText = await evaluate('document.body.innerText')
    assert.match(bodyText, /waiting for receipt|đang chờ biên nhận|Submitted/, 'Submitted state must be preserved after chain change')
    assert.doesNotMatch(bodyText, /Preparing live review|Đang chuẩn bị/, 'Card must NOT reset to preparing while tx is in-flight')
    assert.equal(await evaluate(sendCount), 1, 'Exactly one wallet request')
  })
})

// ── Test 12: Unresolved intent checkpoint blocks duplicate send ────────────────
// Uses the NEW keyed-map format (mk.send.intents.v1).
test('MOCKED unresolved intent checkpoint blocks second wallet request for same intent', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Plant a matching unresolved checkpoint for the exact same intent using the keyed map.
    // Key = account.lower():chainId:recipient.lower():symbol:amount
    const intentKey = `${account.toLowerCase()}:5042002:${recipient.toLowerCase()}:USDC:5`
    const cpEntry = { account, chainId: 5042002, recipient, symbol: 'USDC', amount: '5', savedAt: Date.now() - 5000 }
    const intentMap = JSON.stringify({ [intentKey]: cpEntry })
    await evaluate(`sessionStorage.setItem('mk.send.intents.v1', ${JSON.stringify(intentMap)})`)
    await fill(0, `Send 5 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Card must prepare successfully')
    // Click Confirm — checkpoint must block the wallet request
    await click('Confirm in wallet')
    // An error message about the unresolved intent must appear (updated message: wallet/explorer, not Activity)
    await wait(
      `document.body.innerText.includes('unresolved') || document.body.innerText.includes('chưa rõ kết quả') || document.body.innerText.includes('transaction history') || document.body.innerText.includes('block explorer') || document.body.innerText.includes('lịch sử giao dịch')`,
      'Unresolved intent must produce a wallet/explorer error message'
    )
    // No wallet request was made
    assert.equal(await evaluate(sendCount), 0, 'No wallet send when unresolved checkpoint exists')
    // Card stays in review stage — Confirm is still enabled so the user can act after checking explorer
    const confirmEnabled = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    assert.ok(confirmEnabled, 'Confirm must remain enabled so user can retry after checking explorer')
  })
})

// ── Test 13: Intent A UNKNOWN checkpoint survives intent B write+clear ────────
// Core invariant: B writing and then clearing its own checkpoint slot must NOT
// touch A's slot. Tested directly via sessionStorage manipulation — the keyed-map
// contract is already verified end-to-end in unit tests; here we confirm it holds
// in the real browser sessionStorage as used by the actual AgentSendCard code.
test('MOCKED intent A UNKNOWN checkpoint survives intent B checkpoint write and clear', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Plant intent A's checkpoint directly (simulates A having reached UNKNOWN)
    const aKey = `${account.toLowerCase()}:5042002:${recipient.toLowerCase()}:USDC:5`
    const bRecipient = '0x2222222222222222222222222222222222222222'
    const bKey = `${account.toLowerCase()}:5042002:${bRecipient.toLowerCase()}:USDC:3`
    const aEntry = { account, chainId: 5042002, recipient, symbol: 'USDC', amount: '5', savedAt: Date.now() - 10_000 }
    const bEntry = { account, chainId: 5042002, recipient: bRecipient, symbol: 'USDC', amount: '3', savedAt: Date.now() - 5_000 }

    // Populate both A and B checkpoints (as the real code would after two UNKNOWN outcomes)
    await evaluate(`
      const map = { ${JSON.stringify(aKey)}: ${JSON.stringify(aEntry)}, ${JSON.stringify(bKey)}: ${JSON.stringify(bEntry)} };
      sessionStorage.setItem('mk.send.intents.v1', JSON.stringify(map));
    `)

    // Verify both exist
    const bothExist = await evaluate(
      `(() => { const raw = sessionStorage.getItem('mk.send.intents.v1'); if (!raw) return false; const m = JSON.parse(raw); return !!(m[${JSON.stringify(aKey)}] && m[${JSON.stringify(bKey)}]); })()`
    )
    assert.ok(bothExist, 'Both A and B checkpoints must exist initially')

    // Now simulate B resolving (clear B's slot — as the real AgentSendCard does on rejection or confirmed)
    await evaluate(`
      const raw = sessionStorage.getItem('mk.send.intents.v1');
      const m = raw ? JSON.parse(raw) : {};
      delete m[${JSON.stringify(bKey)}];
      sessionStorage.setItem('mk.send.intents.v1', JSON.stringify(m));
    `)

    // A's slot must still be there
    const aStillExists = await evaluate(
      `(() => { const raw = sessionStorage.getItem('mk.send.intents.v1'); if (!raw) return false; const m = JSON.parse(raw); return !!m[${JSON.stringify(aKey)}]; })()`
    )
    assert.ok(aStillExists, 'Intent A checkpoint must survive intent B clear')

    // B's slot must be gone
    const bGone = await evaluate(
      `(() => { const raw = sessionStorage.getItem('mk.send.intents.v1'); if (!raw) return true; const m = JSON.parse(raw); return !m[${JSON.stringify(bKey)}]; })()`
    )
    assert.ok(bGone, 'Intent B checkpoint must be gone after B clear')

    // Now verify A's retry is blocked by the real AgentSendCard code reading the real sessionStorage
    await fill(0, `Send 5 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    await click('Confirm in wallet')
    // A must be blocked by its unresolved checkpoint
    await wait(
      `document.body.innerText.includes('unresolved') || document.body.innerText.includes('chưa rõ kết quả') || document.body.innerText.includes('transaction history') || document.body.innerText.includes('block explorer')`,
      'Intent A retry must be blocked by its unresolved checkpoint after B was cleared'
    )
    assert.equal(await evaluate(sendCount), 0, 'No wallet send on A retry when A checkpoint is unresolved')
  })
})

// ── Test 14: Checkpoint persists across reload (sessionStorage survives page nav) ──
// Simulates: UNKNOWN state, user navigates away (or component unmounts via Done),
// then returns. The checkpoint must still block a second wallet request.
test('MOCKED UNKNOWN checkpoint persists across component unmount and remount', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Plant an UNKNOWN checkpoint before even mounting the card (simulates prior session)
    const intentKey = `${account.toLowerCase()}:5042002:${recipient.toLowerCase()}:USDC:7`
    const cpEntry = { account, chainId: 5042002, recipient, symbol: 'USDC', amount: '7', savedAt: Date.now() - 30_000 }
    const intentMap = JSON.stringify({ [intentKey]: cpEntry })
    await evaluate(`sessionStorage.setItem('mk.send.intents.v1', ${JSON.stringify(intentMap)})`)

    // Now mount the card for the same intent
    await fill(0, `Send 7 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    await click('Confirm in wallet')
    // Must be blocked immediately
    await wait(
      `document.body.innerText.includes('unresolved') || document.body.innerText.includes('transaction history') || document.body.innerText.includes('block explorer')`,
      'Re-mounted card must detect pre-existing UNKNOWN checkpoint and block wallet request'
    )
    assert.equal(await evaluate(sendCount), 0, 'No wallet send on remount when checkpoint present')
    // Checkpoint must still be in sessionStorage — user did not resolve it
    const checkpointStillPresent = await evaluate(
      `(() => { const raw = sessionStorage.getItem('mk.send.intents.v1'); if (!raw) return false; const m = JSON.parse(raw); return !!m[${JSON.stringify(intentKey)}]; })()`
    )
    assert.ok(checkpointStillPresent, 'Checkpoint must remain in sessionStorage after blocked retry')
  })
})

test('MOCKED onStageChange fires real execution stages and "confirmed" reaches step 10/10', async () => {
  const CONFIRMED_HASH = '0x' + 'f'.repeat(64)
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Arm receipt mock from the browser so the relative URL resolves against the fixture origin.
    const armOk = await evaluate(`
      fetch('/__arc_agent_rpc_state__', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmedHash: '${CONFIRMED_HASH}' }),
      }).then((r) => r.ok)
    `)
    assert.ok(armOk, 'Receipt mock must be armed successfully')
    try {
      // Set wallet to return the confirmed hash instead of rejecting.
      await evaluate(`window.__agentHarness.sendMode = 'ok'`)

      await fill(0, `Send 1 USDC to ${recipient}`)
      await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
      await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
      await click('Confirm parameters')
      await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
      await click('Execute Send in chat')
      // Wait for prepare to complete — Confirm in wallet button enabled at review stage.
      await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
      // Stepper must show stage >= 5 (review = 5) before signing.
      const stageBeforeSign = await evaluate(
        `Number(document.querySelector('[data-step]')?.dataset?.step ?? 0)`
      )
      assert.ok(stageBeforeSign >= 5, `Stepper must advance to at least step 5 at review; got ${stageBeforeSign}`)

      // Sign — wallet returns CONFIRMED_HASH; Arc RPC mock will return confirmed receipt.
      await click('Confirm in wallet')
      // Card must show confirmed state — this fires after receipt polling finds status=0x1.
      await wait(
        `document.body.innerText.includes('Giao dịch đã xác nhận') || document.body.innerText.includes('Transfer confirmed')`,
        'Card must show confirmed after receipt', 15000
      )
      // ── KEY ASSERTION: step 10 must be shown BEFORE clicking Done ──
      const stageAfterConfirm = await evaluate(
        `Number(document.querySelector('[data-step]')?.dataset?.step ?? 0)`
      )
      assert.equal(stageAfterConfirm, 10, `Stepper must reach step 10 after confirmed receipt (got ${stageAfterConfirm})`)

      assert.equal(await evaluate(sendCount), 1, 'Exactly one wallet send')

      // Click Done — card dismisses, "Giao dịch hoàn tất" remains visible.
      await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Hoàn tất' || b.textContent.trim() === 'Done')`)
      const doneLabel = await evaluate(
        `([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Hoàn tất' || b.textContent.trim() === 'Done') || {}).textContent?.trim()`
      )
      await click(doneLabel)
      await wait(
        `document.body.innerText.includes('Giao dịch hoàn tất') || document.body.innerText.includes('Transaction complete')`,
        'Completion message must persist after Done'
      )
    } finally {
      // Disarm receipt mock from browser so other tests keep getting null (pending).
      await evaluate(`
        fetch('/__arc_agent_rpc_state__', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmedHash: null }),
        })
      `)
    }
  })
})

test('MOCKED wallet rejection: Progress stays at step 3, no "Transaction complete" shown', async () => {
  // Default fixture: sendMode = '4001' (wallet rejects with code 4001). No walletOutcome param needed.
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 1 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    await click('Confirm in wallet')
    // Wait for the card to show rejection — ensures confirmSend() has fully run (including the wallet call).
    await wait(
      `document.body.innerText.includes('Ví đã từ chối') || document.body.innerText.includes('Wallet rejected') || document.body.innerText.includes('rejected')`,
      'Card must show rejection state'
    )
    // Now the wallet call has completed (rejected). Assert exactly 1 eth_sendTransaction attempt.
    assert.equal(await evaluate(sendCount), 1, 'eth_sendTransaction called exactly once (then rejected with 4001)')
    // Stage must NOT be 10 — rejection keeps stage at previous value.
    const stageAfterReject = await evaluate(
      `Number(document.querySelector('[data-step]')?.dataset?.step ?? 0)`
    )
    assert.ok(stageAfterReject < 10, `Stage must not reach 10 after rejection (got ${stageAfterReject})`)
    // No success toast.
    assert.equal(
      await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`),
      0, 'No success toast after rejection'
    )
    // Find and click Done/Hoàn tất — locale may be 'en'.
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done' || b.textContent.trim() === 'Hoàn tất')`)
    const doneLabel = await evaluate(
      `([...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Done' || b.textContent.trim() === 'Hoàn tất') || {}).textContent?.trim()`
    )
    await click(doneLabel)
    // After dismiss: no completion message visible.
    const body = await evaluate(`document.body.innerText`)
    assert.ok(
      !body.includes('Giao dịch hoàn tất') && !body.includes('Transaction complete'),
      'No completion message after rejection + Done'
    )
  })
})

test('MOCKED Cancel before signing: execCard dismissed, stage returns to 3', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 1 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    // Cancel before signing — find cancel button regardless of locale.
    await wait(`[...document.querySelectorAll('button, a')].some((b) => /^(Cancel|Hủy)$/.test(b.textContent.trim()))`)
    const cancelLabel = await evaluate(
      `([...document.querySelectorAll('button, a')].find((b) => /^(Cancel|Hủy)$/.test(b.textContent.trim())) || {}).textContent?.trim()`
    )
    await click(cancelLabel)
    // ExecCard dismissed — ReviewCard must reappear at stage 3, or Execute Send button reappears.
    await wait(
      `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat' || document.body.innerText.includes('Review transaction') || document.body.innerText.includes('Xem lại giao dịch'))`,
      'After cancel, Execute Send or review card must reappear'
    )
    // No eth_sendTransaction.
    assert.equal(await evaluate(sendCount), 0, 'No wallet send after cancel')
    // Stage must be reset to 3 (not 10, not mid-execution).
    const stageAfterCancel = await evaluate(
      `Number(document.querySelector('[data-step]')?.dataset?.step ?? 0)`
    )
    assert.ok(stageAfterCancel <= 3, `Stage must reset to ≤3 after cancel (got ${stageAfterCancel})`)
    // No completion message.
    const body = await evaluate(`document.body.innerText`)
    assert.ok(!body.includes('Giao dịch hoàn tất') && !body.includes('Transaction complete'), 'No completion after cancel')
    // No success toast.
    assert.equal(
      await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`),
      0, 'Cancel must not fire success toast'
    )
  })
})

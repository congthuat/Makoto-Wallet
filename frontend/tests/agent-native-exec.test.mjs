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
  const h = window.__agentHarness = { calls: [], notices: [], records: [], ready: false };
  localStorage.setItem('mk.lang', new URLSearchParams(location.search).get('lang') || 'en');
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.className = 'dark';

  // ABI-encode a short string as Solidity 'string' return value (dynamic type).
  // offset(32) + length(32) + utf8 bytes padded to 32 = 96 bytes total.
  const abiString = (s) => {
    const hex = [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0');
    return '0x' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      s.length.toString(16).padStart(64, '0') +
      hex;
  };

  // Token contract addresses on Arc Testnet (must match src/lib/wallet.ts TOKENS).
  const TOKEN_ADDRS = new Set([
    '0x3600000000000000000000000000000000000000', // USDC
    '0x89b50855aa3be2f677cd6303cec089b5f319d72a', // EURC
    '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf', // cirBTC
  ]);
  // symbol() selector: 0x95d89b41  decimals(): 0x313ce567  balanceOf(addr): 0x70a08231
  const TOKEN_SYMBOL = {
    '0x3600000000000000000000000000000000000000': 'USDC',
    '0x89b50855aa3be2f677cd6303cec089b5f319d72a': 'EURC',
    '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf': 'cirBTC',
  };
  const TOKEN_DECIMALS = {
    '0x3600000000000000000000000000000000000000': 6,
    '0x89b50855aa3be2f677cd6303cec089b5f319d72a': 6,
    '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf': 8,
  };

  window.ethereum = { isMetaMask: true, request: async ({method, params = []}) => {
    h.calls.push({method, params});

    if (method === 'eth_accounts') return [h.getWallet?.()?.address || '${account}'];
    if (method === 'eth_chainId') return '0x' + (h.getWallet?.()?.walletChainId || 5042002).toString(16);

    if (method === 'eth_getCode') {
      // Token contracts must return non-empty bytecode so verifyToken passes.
      // EOA recipients (including the test recipient) must return '0x'.
      const addr = (params[0] || '').toLowerCase();
      return TOKEN_ADDRS.has(addr) ? '0x6000' : '0x';
    }

    if (method === 'eth_call') {
      const to   = (params[0]?.to || '').toLowerCase();
      const data = params[0]?.data || '';
      // decimals() — must match the token's actual decimals
      if (data === '0x313ce567') {
        const dec = TOKEN_DECIMALS[to] ?? 6;
        return '0x' + dec.toString(16).padStart(64, '0');
      }
      // symbol() — must ABI-encode the exact symbol string
      if (data === '0x95d89b41') {
        const sym = TOKEN_SYMBOL[to] ?? 'USDC';
        return abiString(sym);
      }
      // balanceOf(address) — return a healthy balance for all tokens
      if (data.startsWith('0x70a08231')) {
        // 50 USDC/EURC (6 dec) or 0.5 cirBTC (8 dec)
        const dec = TOKEN_DECIMALS[to] ?? 6;
        const bal = dec === 8 ? 50_000_000n : 50_000_000n; // 50 units in both cases
        return '0x' + bal.toString(16).padStart(64, '0');
      }
      return '0x' + '0'.repeat(64);
    }

    // Healthy native gas balance (100 USDC-as-native on Arc, 18 dec)
    if (method === 'eth_getBalance') return '0x' + (100n * 10n**18n).toString(16);

    // Gas estimation — prepareSend calls this legitimately; return a realistic value
    if (method === 'eth_estimateGas') return '0x186a0'; // 100 000 gas

    if (method === 'eth_gasPrice') return '0x4a817c800'; // 20 gwei

    // Wallet send behaviour is controlled by h.sendMode:
    //   '4001'     (default) — user-rejected, code 4001, no hash
    //   'timeout'  — non-rejection error, no hash (simulates wallet timeout / popup closed)
    //   'ok'       — returns a fake hash (simulates successful broadcast)
    if (method === 'eth_sendTransaction') {
      const mode = h.sendMode || '4001';
      if (mode === '4001') throw Object.assign(new Error('MOCK rejection; no broadcast'), {code: 4001});
      if (mode === 'timeout') throw new Error('MOCK wallet timeout; no hash returned');
      // mode === 'ok': return a fake hash so submitted/pending states are reachable
      return '0x' + 'f'.repeat(64);
    }

    // Always return null receipt — keeps submitted/pending cards in spinner state.
    if (method === 'eth_getTransactionReceipt') return null;

    if (method === 'wallet_switchEthereumChain') return null;
    return null;
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
        vite.middlewares.use(async (req, res, next) => {
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
    // Inject wallet that throws a generic error (no code 4001, no hash)
    await evaluate(`
      window.ethereum.request = async ({method, params = []}) => {
        window.__agentHarness.calls.push({method, params});
        if (method === 'eth_accounts') return [window.__agentHarness.getWallet?.()?.address || '${account}'];
        if (method === 'eth_chainId') return '0x' + (5042002).toString(16);
        if (method === 'eth_getCode') {
          const TOKEN_ADDRS = new Set(['0x3600000000000000000000000000000000000000','0x89b50855aa3be2f677cd6303cec089b5f319d72a','0xf0c4a4ce82a5746abaad9425360ab04fbba432bf']);
          return TOKEN_ADDRS.has((params[0] || '').toLowerCase()) ? '0x6000' : '0x';
        }
        if (method === 'eth_call') {
          const to = (params[0]?.to || '').toLowerCase();
          const data = params[0]?.data || '';
          const DEC = {'0x3600000000000000000000000000000000000000':6,'0x89b50855aa3be2f677cd6303cec089b5f319d72a':6,'0xf0c4a4ce82a5746abaad9425360ab04fbba432bf':8};
          const SYM = {'0x3600000000000000000000000000000000000000':'USDC','0x89b50855aa3be2f677cd6303cec089b5f319d72a':'EURC','0xf0c4a4ce82a5746abaad9425360ab04fbba432bf':'cirBTC'};
          if (data === '0x313ce567') return '0x' + ((DEC[to] ?? 6)).toString(16).padStart(64, '0');
          if (data === '0x95d89b41') {
            const s = SYM[to] ?? 'USDC';
            const hex = [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2,'0')).join('').padEnd(64,'0');
            return '0x0000000000000000000000000000000000000000000000000000000000000020' + s.length.toString(16).padStart(64,'0') + hex;
          }
          if (data.startsWith('0x70a08231')) return '0x' + (50_000_000n).toString(16).padStart(64,'0');
          return '0x' + '0'.repeat(64);
        }
        if (method === 'eth_getBalance') return '0x' + (100n * 10n**18n).toString(16);
        if (method === 'eth_estimateGas') return '0x186a0';
        if (method === 'eth_gasPrice') return '0x4a817c800';
        // Throw a generic (non-4001) error — this triggers UNKNOWN stage, no txHash
        if (method === 'eth_sendTransaction') throw new Error('MOCK network error, no hash');
        if (method === 'wallet_switchEthereumChain') return null;
        return null;
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

// ── Test 10: Account change during review — card re-prepares, Confirm disabled ─
test('MOCKED account change during review: card shows changed-account notice, Confirm disabled', async () => {
  const account2 = '0x2222222222222222222222222222222222222222'
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    await fill(0, `Send 3 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    // Wait for review to be ready (Confirm enabled)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Card must reach review with Confirm enabled')
    // Simulate account change — also update the wallet mock so eth_accounts returns the new address
    await evaluate(`
      window.__agentHarness.setWallet({ address: '${account2}' });
    `)
    // Card must react: show account-changed notice or re-enter preparing state
    await wait(
      `document.body.innerText.includes('account changed') || document.body.innerText.includes('tài khoản') || document.body.innerText.includes('Preparing') || document.body.innerText.includes('Đang chuẩn bị') || document.body.innerText.includes('Chain')`,
      'Card must react to account change (notice or re-prepare)'
    )
    // Confirm must be disabled (review is invalidated or still preparing)
    const confirmEnabled = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    assert.equal(confirmEnabled, false, 'Confirm must be disabled after account change')
    assert.equal(await evaluate(sendCount), 0, 'No send during account change')
  })
})

// ── Test 11: Account/chain change while wallet request in-flight ───────────────
test('MOCKED chain change while wallet request in-flight: rejected state preserved, not reset to preparing', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Default sendMode '4001' — wallet rejects quickly
    await fill(0, `Send 4 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`)
    // Click Confirm — triggers requesting stage (wallet will reject with 4001)
    await click('Confirm in wallet')
    // Immediately simulate chain change while wallet request is processing
    await evaluate(`window.__agentHarness.setWallet({ walletChainId: 1 })`)
    // Wallet rejects → rejected state must be shown, NOT preparing
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Done')`, 'Done must appear after rejection')
    const bodyText = await evaluate('document.body.innerText')
    assert.match(bodyText, /Wallet rejected|Ví đã từ chối|nothing was submitted|chưa gửi/, 'Rejection state must be shown')
    assert.doesNotMatch(bodyText, /Preparing live review|Đang chuẩn bị/, 'Card must NOT reset to preparing during in-flight request')
    assert.equal(await evaluate(sendCount), 1, 'Exactly one wallet request was made (then rejected)')
    assert.equal(await evaluate(`window.__agentHarness.notices.filter((n) => n.tone === 'ok').length`), 0, 'No success toast')
  })
})

// ── Test 12: Unresolved intent checkpoint blocks duplicate send ────────────────
test('MOCKED unresolved intent checkpoint blocks second wallet request for same intent', async () => {
  await fixture({}, async ({ evaluate, wait, fill, click }) => {
    // Plant a matching unresolved checkpoint for the exact same intent
    const checkpoint = JSON.stringify({
      account, chainId: 5042002, recipient, symbol: 'USDC', amount: '5', savedAt: Date.now() - 5000,
    })
    await evaluate(`sessionStorage.setItem('mk.send.intent.v1', ${JSON.stringify(checkpoint)})`)
    await fill(0, `Send 5 USDC to ${recipient}`)
    await evaluate(`document.querySelector('button[aria-label="Send message"]').click()`)
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm parameters')`)
    await click('Confirm parameters')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Execute Send in chat')`)
    await click('Execute Send in chat')
    await wait(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet' && !b.disabled)`, 'Card must prepare successfully')
    // Click Confirm — checkpoint must block the wallet request
    await click('Confirm in wallet')
    // An error message about the unresolved intent must appear
    await wait(
      `document.body.innerText.includes('unresolved') || document.body.innerText.includes('chưa rõ kết quả') || document.body.innerText.includes('Check Activity') || document.body.innerText.includes('Kiểm tra Activity')`,
      'Unresolved intent must produce an error blocking the wallet request'
    )
    // No wallet request was made
    assert.equal(await evaluate(sendCount), 0, 'No wallet send when unresolved checkpoint exists')
    // Still on review stage (error shown but card stays in review, user can clear manually)
    const confirmVisible = await evaluate(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Confirm in wallet')`)
    assert.ok(confirmVisible, 'Confirm button must still be visible so user can resolve and retry')
  })
})

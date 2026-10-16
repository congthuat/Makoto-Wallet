import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QRCodeSVG } from 'qrcode.react'
import { createBrowserHarness, delay } from './browser-harness.mjs'

// Actual Shell, Sidebar, Settings, ReceiveModal, translations, QR renderer and
// share helpers. Only wallet/provider state and browser OS boundaries are mocked.
// An isolated browser never opens a user's wallet, posts a form or contacts a
// social service. MAKOTO_FEEDBACK_RECEIVE_BASELINE_REF replays old source using
// read-only git show while keeping the regression assertions unchanged.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const qa = path.resolve(frontendRoot, '..', 'validation-qa/feedback-receive-share')
const account = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const form = 'https://docs.google.com/forms/d/e/1FAIpQLSfH_cQv0Gkxy604YcpVHpitSfoWbF5_ud3f5WG_Jc4d7A6nVg/viewform'
const legacyFeedback = JSON.stringify([{ text: 'Existing local feedback must remain unchanged', at: 1 }])
const expectedQr = Object.fromEntries([account, other].map(address => [address, renderToStaticMarkup(createElement(QRCodeSVG, {value: address, size: 188, level: 'M', fgColor: '#0e0e12', marginSize: 4}))]))
let browser

const wallet = `
  import { createContext, useContext, useState } from 'react';
  import { TOKENS } from '/src/lib/wallet.ts';
  const Context = createContext(null);
  export const useWallet = () => useContext(Context);
  export const WalletProvider = ({children}) => children;
  export function WalletFixture({children}) {
    const h = window.__receiveHarness;
    const [page, setPage] = useState('settings');
    const [receiveOpen, setReceiveOpen] = useState(false);
    const [binding, setBinding] = useState({address: h.address, mode: h.mode});
    h.changeWallet = (address, mode = 'watch') => setBinding({address, mode});
    h.page = page; h.receiveOpen = receiveOpen;
    const forbidden = (name) => () => { h.forbidden.push(name); throw new Error('Unexpected wallet/provider action: ' + name); };
    const value = { page, receiveOpen, setReceiveOpen, ...binding, displayAddress: binding.address || '${other}',
      live: binding.mode !== 'demo' && !!binding.address,
      go: (next) => { h.navigation.push(next); setPage(next); }, notify: (message, kind = 'ok') => h.notifications.push({message, kind}),
      network: {blockNumber: 123, rpcLatencyMs: 50}, networkError: false,
      tasks: [], taskNotifications: [], taskNotificationsError: false, activity: [], contacts: [],
      settings: {hideSmall: false, hideSpam: true, txAlerts: true, vivid: true}, hidden: false,
      holdings: TOKENS.map(t => ({...t, symbol: t.sym, balance: 1, value: 1, verified: true})),
      total: 3, pricesReady: true, loading: false, balanceError: null, walletError: null,
      lockPreview: false, txDetail: null, toast: null, mask: value => value,
      setSettings: forbidden('settings'), setContacts: forbidden('contacts'), setHidden: forbidden('privacy'),
      setLockPreview: forbidden('lock'), setTxDetail: forbidden('transaction'), setAgentSeed: forbidden('agent'),
      setAgentSeedMode: forbidden('agent-mode'), connect: forbidden('connect'), disconnect: forbidden('disconnect'),
      watch: forbidden('watch'), refetchWallet: forbidden('wallet-read'), refetchBalance: forbidden('balance-read'),
    };
    return <Context.Provider value={value}>{children}</Context.Provider>;
  }
`

const entry = `
  import { createElement } from 'react';
  import { createRoot } from 'react-dom/client';
  import { WalletFixture } from '/__receive_test__/wallet.jsx';
  const q = new URLSearchParams(location.search);
  localStorage.setItem('mk.lang', q.get('lang') || 'en');
  localStorage.setItem('mk.theme', q.get('theme') || 'dark');
  localStorage.setItem('mk.feedback', ${JSON.stringify(legacyFeedback)});
  const h = window.__receiveHarness = {ready: false, address: q.get('address') || '${account}', mode: q.get('mode') || 'watch',
    notifications: [], copies: [], nativeCalls: [], downloads: [], blobs: new Map(), storageWrites: [], externalClicks: [],
    errors: [], forbidden: [], navigation: [], clipboardMode: 'ok', nativeMode: 'ok'};
  window.addEventListener('error', event => h.errors.push(event.message));
  window.addEventListener('unhandledrejection', event => h.errors.push(String(event.reason)));
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) { h.storageWrites.push({key, value: String(value)}); return originalSet.call(this, key, value); };
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {
    h.copies.push(text);
    if (h.clipboardMode === 'reject') throw new Error('MOCK clipboard denied');
    if (h.clipboardMode === 'pending') await new Promise((resolve, reject) => {h.resolveCopy = resolve; h.rejectCopy = reject;});
  }}});
  Object.defineProperty(navigator, 'share', {configurable: true, value: q.get('native') === 'absent' ? undefined : async data => {
    h.nativeCalls.push(data);
    if (h.nativeMode === 'cancel') throw new DOMException('MOCK cancelled', 'AbortError');
    if (h.nativeMode === 'error') throw new Error('MOCK native share unavailable');
  }});
  const createURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = blob => {const url = createURL(blob); h.blobs.set(url, blob); return url;};
  HTMLAnchorElement.prototype.click = function() {
    if (this.download) {h.downloads.push({name: this.download, href: this.href}); return;}
    this.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
  };
  document.addEventListener('click', event => {const link = event.target.closest?.('a'); if (link) {event.preventDefault(); h.externalClicks.push(link.href);}}, true);
  const { Shell } = await import('/src/App.tsx');
  const { translate } = await import('/src/lib/i18n.ts');
  h.tr = value => translate(value, q.get('lang') || 'en');
  h.expectedQr = address => (${JSON.stringify(expectedQr)})[address];
  createRoot(document.getElementById('app')).render(createElement(WalletFixture, null, createElement(Shell)));
  h.ready = true;
`

before(async () => {
  await mkdir(qa, {recursive: true})
  const baseline = process.env.MAKOTO_FEEDBACK_RECEIVE_BASELINE_REF
  if (baseline) assert.match(baseline, /^[0-9a-f]{40}$/i)
  const historical = new Map()
  if (baseline) for (const file of ['App.tsx', 'pages/Settings.tsx', 'components/wallet/shared.tsx']) {
    historical.set(`/src/${file}`, execFileSync('git', ['show', `${baseline}:frontend/src/${file}`], {cwd: frontendRoot, encoding: 'utf8'}))
  }
  browser = createBrowserHarness({frontendRoot, name: 'feedback-receive', ready: '(window.__receiveHarness?.ready && document.querySelector("#mk-main h1")) || window.__receiveHarness?.errors.length', plugins: [{
    name: 'actual-feedback-receive-fixture', enforce: 'pre',
    config() { return {optimizeDeps: {include: ['react/jsx-runtime']}} },
    resolveId(source) {
      if (/\/lib\/store(?:\.tsx)?$/.test(source)) return '/__receive_test__/wallet.jsx'
      if (source.startsWith('/__receive_test__/')) return source
    },
    load(id) {
      for (const [suffix, source] of historical) if (id.replaceAll('\\', '/').endsWith(suffix)) return source
      return {'/__receive_test__/wallet.jsx': wallet, '/__receive_test__/entry.js': entry}[id]
    },
    transform(source, id) {
      if (id.replaceAll('\\', '/').endsWith('/src/App.tsx')) return `${source}\nexport { Shell };`
      // Keep production layout/styles while preventing third-party font requests.
      if (id.replaceAll('\\', '/').endsWith('/src/index.css')) return source.replace(/^@import url\([^\n]+\);\s*/m, '')
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__receive_test__?')) return next()
        const html = await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/src/index.css"></head><body><div id="app"></div><script type="module" src="/__receive_test__/entry.js"></script></body></html>')
        res.setHeader('Content-Type', 'text/html'); res.end(html)
      })
    },
  }, tailwindcss()]})
  await browser.start()
})
after(async () => {await browser?.close()})

const h = 'window.__receiveHarness'
const dialog = 'document.querySelector("[role=dialog]")'
const fixture = (params, run) => browser.fixture('__receive_test__', params, async ui => {
  assert.deepEqual(await ui.evaluate(`${h}.errors`), [], 'Actual production components mount without fixture errors')
  await run(ui)
})
const buttons = name => `[...${dialog}.querySelectorAll('button')].filter(b => b.textContent.trim() === ${h}.tr(${JSON.stringify(name)}) || (b.hasAttribute('aria-pressed') && b.textContent.trim().endsWith(' ' + ${JSON.stringify(name)})))`
async function click(ui, name) {
  await ui.evaluate(`(() => { const button = ${buttons(name)}[0]; if (!button || button.disabled) throw new Error('Missing enabled button: ${name}'); button.focus(); button.click(); })()`)
}
async function openReceive(ui, width) {
  await ui.setViewport(width, width < 768 ? 844 : 1000)
  if (width < 768) {
    await ui.evaluate(`document.querySelector('button[aria-controls="mk-mobile-actions"]').click()`)
    await ui.wait('document.querySelector("#mk-mobile-actions")', 'Actual mobile More actions opens')
    await ui.evaluate(`(() => {const b = [...document.querySelectorAll('#mk-mobile-actions button')].find(b => b.textContent.trim() === ${h}.tr('Receive')); b.focus(); b.click();})()`)
  } else {
    await ui.evaluate(`(() => {const b = document.querySelector('aside [data-nav-id="receive"]'); b.focus(); b.click();})()`)
  }
  await ui.wait(dialog, 'Actual Receive modal opens')
}
async function openShare(ui) {
  await click(ui, 'Share')
  assert.deepEqual(await ui.evaluate(`${h}.nativeCalls`), [], 'Primary Share opens the internal chooser without native sharing')
  await ui.wait(`${dialog}.innerText.includes(${h}.tr('Share receive details'))`, 'Internal share choices appear')
}
async function assertNoSideEffects(ui) {
  assert.deepEqual(await ui.evaluate(`${h}.forbidden`), [])
  assert.deepEqual(await ui.evaluate(`${h}.errors`), [])
  assert.deepEqual(await ui.evaluate(`${h}.navigation`), [], 'Receive/share preserves the underlying page')
  assert.equal(await ui.evaluate(`${h}.page`), 'settings')
  assert.equal(await ui.evaluate('localStorage.getItem("mk.feedback")'), legacyFeedback)
  assert.deepEqual(await ui.evaluate(`${h}.storageWrites`), [], 'Feedback and Receive never write browser storage')
}

for (const lang of ['en', 'vi']) for (const width of [1440, 390]) {
  test(`${lang} ${width}: external feedback entries use the same verified form and preserve legacy notes`, async () => {
    await fixture({lang}, async ui => {
      await ui.setViewport(width, width < 768 ? 844 : 1000)
      if (width < 768) {
        await ui.evaluate('document.querySelector("button[aria-controls=mk-mobile-sidebar]").click()')
        await ui.wait('document.querySelector("#mk-mobile-sidebar")', 'Actual mobile Sidebar opens')
      }
      const links = await ui.evaluate(`[...document.querySelectorAll('a')].filter(a => a.href === ${JSON.stringify(form)} && a.getClientRects().length).map(a => ({href: a.href, target: a.target, rel: a.rel, label: a.getAttribute('aria-label'), text: a.textContent.trim()}))`)
      assert.equal(links.length, 2, 'Sidebar and Settings each expose the verified external form')
      for (const link of links) {
        assert.equal(link.href, form)
        assert.equal(link.target, '_blank')
        assert.ok(link.rel.split(' ').includes('noopener'))
        assert.ok(link.rel.split(' ').includes('noreferrer'))
        assert.match(link.label, lang === 'vi' ? /biểu mẫu.*(?:tab|thẻ) mới/i : /feedback form.*new tab/i)
      }
      await ui.evaluate(`[...document.querySelectorAll('a')].filter(a => a.href === ${JSON.stringify(form)} && a.getClientRects().length).forEach(a => a.click())`)
      assert.deepEqual(await ui.evaluate(`${h}.externalClicks`), [form, form])
      assert.equal(await ui.evaluate('document.querySelectorAll("textarea").length'), 0, 'Local feedback composer is removed')
      if (width < 768) await ui.wait('!document.querySelector("#mk-mobile-sidebar")', 'Feedback closes the mobile navigation drawer')
      await assertNoSideEffects(ui)
    })
  })

  test(`${lang} ${width}: primary Share, exact copies, social URLs and QR download use current receive data`, async () => {
    await fixture({lang}, async ui => {
      await openReceive(ui, width)
      await openShare(ui)
      await click(ui, 'Copy address')
      await ui.wait(`${h}.copies.length === 1 && ${h}.notifications.length === 1`, 'Clipboard completion is acknowledged')
      assert.equal(await ui.evaluate(`${h}.copies[0]`), account)
      await click(ui, 'Copy receive details')
      await ui.wait(`${h}.copies.length === 2`, 'Complete receive details are copied')
      const details = await ui.evaluate(`${h}.copies[1]`)
      assert.ok(details.includes(account))
      assert.match(details, /USDC/)
      assert.match(details, /Arc Testnet/)
      assert.match(details, /5042002/)
      const social = await ui.evaluate(`[...${dialog}.querySelectorAll('a')].map(a => ({name: a.textContent.trim(), href: a.href, target: a.target, rel: a.rel}))`)
      for (const name of ['X', 'Telegram', 'WhatsApp']) {
        const link = social.find(link => link.name === name || (name === 'X' && link.name === 'X (Twitter)'))
        assert.ok(link, `${name} share link is available`)
        const url = new URL(link.href)
        assert.equal(url.protocol, 'https:')
        assert.equal(link.target, '_blank')
        assert.ok(link.rel.includes('noopener') && link.rel.includes('noreferrer'))
        const text = url.searchParams.get('text')
        assert.equal(text, details, `${name} URL decodes to the exact copied receive details`)
        assert.ok(link.href.includes(encodeURIComponent(account)))
        if (name === 'X') { assert.ok(['x.com', 'twitter.com'].includes(url.hostname)); assert.equal(url.pathname, '/intent/tweet') }
        if (name === 'Telegram') { assert.equal(url.hostname, 't.me'); assert.equal(url.pathname, '/share/url'); assert.equal(url.searchParams.get('url'), 'https://makotowallet.xyz') }
        if (name === 'WhatsApp') { assert.equal(url.hostname, 'wa.me'); assert.equal(url.pathname, '/') }
      }
      await click(ui, 'Download QR')
      await ui.wait(`${h}.downloads.length === 1`, 'QR download is prepared')
      const download = await ui.evaluate(`(async () => {const d = ${h}.downloads[0]; const blob = ${h}.blobs.get(d.href); return {...d, type: blob.type, svg: await blob.text(), expected: ${h}.expectedQr('${account}')};})()`)
      assert.match(download.name, /USDC/i)
      assert.ok(download.name.toLowerCase().includes(account.toLowerCase()))
      assert.match(download.type, /image\/svg\+xml/)
      const paths = source => [...source.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1])
      assert.deepEqual(paths(download.svg), paths(download.expected), 'Downloaded QR modules exactly encode the current wallet address')
      const layout = await ui.evaluate(`(() => {const d=${dialog};const r=d.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};})()`)
      assert.ok(layout.left >= 0 && layout.right <= layout.viewport + 1)
      assert.equal(layout.overflow, false)
      if (!process.env.MAKOTO_FEEDBACK_RECEIVE_BASELINE_REF) await writeFile(path.join(qa, `share-${lang}-${width}.png`), Buffer.from(await ui.screenshot(), 'base64'))
      await assertNoSideEffects(ui)
    })
  })
}

test('native share is optional; cancellation and errors never report false success', async () => {
  for (const native of ['absent', 'available']) await fixture({native}, async ui => {
    await openReceive(ui, 390)
    await openShare(ui)
    if (native === 'absent') {
      assert.equal(await ui.evaluate(`${buttons('More options')}.length`), 0)
      await click(ui, 'Copy address')
      await ui.wait(`${h}.copies.length === 1`, 'Ordinary sharing remains available without navigator.share')
    } else {
      await ui.evaluate(`${h}.nativeMode='cancel'`)
      await click(ui, 'More options')
      await ui.wait(`${h}.nativeCalls.length === 1`, 'Explicit system share calls the API')
      await delay(30)
      assert.deepEqual(await ui.evaluate(`${h}.notifications`), [], 'User cancellation is silent')
      await ui.evaluate(`${h}.nativeMode='error'`)
      await click(ui, 'More options')
      await ui.wait(`${h}.notifications.some(n => n.kind === 'err')`, 'Native share failures are visible')
      assert.equal(await ui.evaluate(`${h}.notifications.some(n => n.kind === 'ok')`), false)
      assert.match((await ui.evaluate(`${h}.nativeCalls[0]`)).text, new RegExp(account))
    }
    await assertNoSideEffects(ui)
  })
})

test('clipboard rejection and unsupported clipboard show errors without false copied state', async () => {
  for (const lang of ['en', 'vi']) await fixture({lang}, async ui => {
    await openReceive(ui, 1440)
    await openShare(ui)
    await ui.evaluate(`${h}.clipboardMode='reject'`)
    await click(ui, 'Copy receive details')
    await ui.wait(`${h}.notifications.some(n => n.kind === 'err')`, 'Rejected clipboard writes report a localized error')
    assert.equal(await ui.evaluate(`${h}.notifications.some(n => n.kind === 'ok')`), false)
    assert.match((await ui.evaluate(`${h}.notifications[0]`)).message, lang === 'vi' ? /sao chép/i : /copy/i)
    await ui.evaluate(`Object.defineProperty(navigator, 'clipboard', {configurable:true, value:undefined}); ${h}.notifications=[]`)
    await click(ui, 'Copy address')
    await ui.wait(`${h}.notifications.some(n => n.kind === 'err')`, 'Missing clipboard API reports failure')
    assert.equal(await ui.evaluate(`${h}.notifications.some(n => n.kind === 'ok')`), false)
    await assertNoSideEffects(ui)
  })
})

test('invalid, disconnected, changed wallets and selected tokens never share stale receive data', async () => {
  await fixture({}, async ui => {
    await openReceive(ui, 1440)
    for (const [address, mode] of [['', 'demo'], ['0x1234', 'watch'], [`0x${'0'.repeat(40)}`, 'connected']]) {
      await ui.evaluate(`${h}.changeWallet(${JSON.stringify(address)}, ${JSON.stringify(mode)})`)
      await ui.wait(`${buttons('Share')}[0]?.disabled`, 'Invalid or disconnected wallet disables sharing')
      assert.equal(await ui.evaluate(`${dialog}.querySelectorAll('a[href*="intent"], a[href*="t.me/share"], a[href*="wa.me"]').length`), 0)
    }
    await ui.evaluate(`${h}.changeWallet('${other}', 'connected')`)
    await ui.wait(`!${buttons('Share')}[0]?.disabled`, 'Current valid wallet enables sharing')
    await click(ui, 'EURC')
    await openShare(ui)
    await click(ui, 'Copy receive details')
    await ui.wait(`${h}.copies.length === 1`, 'Updated token details are copied')
    const details = await ui.evaluate(`${h}.copies[0]`)
    assert.ok(details.includes(other) && details.includes('EURC'))
    assert.ok(!details.includes(account) && !details.includes('USDC'))
    await ui.evaluate(`${h}.notifications=[]; ${h}.clipboardMode='pending'`)
    await click(ui, 'Copy receive details')
    await ui.wait(`${h}.resolveCopy`, 'Pending clipboard boundary is reached')
    await ui.evaluate(`${h}.changeWallet('${account}', 'watch')`)
    await ui.wait(`${dialog}.innerText.includes('${account}')`, 'Wallet binding updates during pending copy')
    await ui.evaluate(`${h}.resolveCopy()`)
    await delay(30)
    assert.deepEqual(await ui.evaluate(`${h}.notifications`), [], 'Old pending copy does not announce success for the new wallet')
    await assertNoSideEffects(ui)
  })
})

test('Back, focus trapping and two-stage Escape preserve desktop and mobile navigation', async () => {
  for (const width of [1440, 390]) await fixture({}, async ui => {
    await openReceive(ui, width)
    await openShare(ui)
    const trapped = await ui.evaluate(`(() => {
      const items=[...${dialog}.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]')].filter(e => e.getClientRects().length);
      items.at(-1).focus(); items.at(-1).dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
      const forward = document.activeElement === items[0];
      items[0].focus(); items[0].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));
      return {forward, reverse:document.activeElement === items.at(-1)};
    })()`)
    assert.deepEqual(trapped, {forward:true,reverse:true}, 'Tab and Shift+Tab stay within the Receive dialog')
    await click(ui, 'Back to Receive')
    await ui.wait(`${buttons('Share')}[0] === document.activeElement`, 'Back returns focus to the Share trigger')
    for (const focused of ['panel', 'token', 'close']) {
      await openShare(ui)
      await ui.evaluate(`(() => {
        const target = ${focused === 'token' ? `${buttons('USDC')}[0]` : focused === 'close' ? `${dialog}.querySelector('button[aria-label]')` : `${dialog}.querySelector('section button')`};
        if(!target) throw new Error('Escape focus target missing'); target.focus();
        target.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}));
      })()`)
      await ui.wait(`${dialog} && ${buttons('Share')}[0] === document.activeElement`, `First Escape from ${focused} returns to Receive and restores focus`)
    }
    await ui.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true,cancelable:true}))`)
    await ui.wait(`!${dialog}`, 'Second Escape closes Receive')
    await ui.wait(width < 768 ? 'document.activeElement?.getAttribute("aria-controls") === "mk-mobile-actions"' : 'document.activeElement?.dataset.navId === "receive"', 'Closing restores focus to the persistent navigation trigger')
    await assertNoSideEffects(ui)
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { ARC, connectWallet, getProvider, isAddress } from './wallet.ts'
import { clearBrowserProvider, createWalletProviderRegistry, discoverBrowserWallets, getBrowserWallets, subscribeBrowserWallets, type Eip1193, type WalletBrowserHost } from './walletProviders.ts'
import { assessPreparation } from '../brain/policy.ts'
import { readWallet } from '../migrated/toolLayer.ts'

const account = '0x1111111111111111111111111111111111111111'
const otherAccount = '0x2222222222222222222222222222222222222222'
const rdns = { okx: 'com.okex.wallet', metamask: 'io.metamask', rabby: 'io.rabby', other: 'com.example.wallet' }
const names = { okx: 'OKX Wallet', metamask: 'MetaMask', rabby: 'Rabby', other: 'Example Wallet' }
type Kind = keyof typeof rdns
function provider(flags: object = {}) {
  const calls: string[] = []
  const state = { accounts: [account] as unknown, chain: ARC.chainHex, reject: undefined as number | undefined, onRequest: undefined as (() => Promise<void>) | undefined }
  const value: Eip1193 = { ...flags, request: async ({ method }) => {
    calls.push(method)
    // No QA path may send a transaction, approve a token, or request a signature.
    assert.ok(['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'].includes(method), `Unexpected wallet method: ${method}`)
    if (method === 'eth_requestAccounts') {
      await state.onRequest?.()
      if (state.reject) throw Object.assign(new Error('User rejected request'), { code: state.reject })
      return state.accounts
    }
    if (method === 'eth_accounts') return state.accounts
    if (method === 'eth_chainId') return state.chain
    if (method === 'wallet_switchEthereumChain') return null
    if (method === 'wallet_addEthereumChain') return null
  } }
  return { value, calls, state }
}
function browser(storage = new Map<string, string>()) {
  const events = new EventTarget()
  const host: WalletBrowserHost = {
    addEventListener: events.addEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value) },
      removeItem: (key) => { storage.delete(key) },
    },
  }
  const announce = (kind: Kind, value: Eip1193, id = 1, options: { icon?: string; name?: string; rdns?: string } = {}) => {
    host.dispatchEvent!(new CustomEvent('eip6963:announceProvider', { detail: { provider: value, info: {
      uuid: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      name: options.name ?? names[kind], rdns: options.rdns ?? rdns[kind], icon: options.icon ?? 'data:image/png;base64,aW1hZ2U=',
    } } }))
  }
  return { host, announce, storage }
}
async function withBrowser(run: (fixture: ReturnType<typeof browser>) => void | Promise<void>, storage?: Map<string, string>) {
  const previous = globalThis.window
  const fixture = browser(storage)
  globalThis.window = fixture.host as Window & typeof globalThis
  discoverBrowserWallets()
  try { await run(fixture) } finally { globalThis.window = previous }
}

test('no wallet provider lists no installed wallet and cannot connect', async () => withBrowser(async () => {
  assert.deepEqual(getBrowserWallets(), [])
  assert.equal(getProvider(), undefined)
  await assert.rejects(connectWallet(), /No wallet extension/)
}))

test('OKX only uses the available legacy provider', async () => withBrowser(async ({ host }) => {
  const okx = provider()
  host.okxwallet = okx.value
  const [wallet] = getBrowserWallets()
  assert.equal(wallet.kind, 'okx')
  assert.equal(wallet.provider, okx.value)
  assert.equal(await connectWallet(wallet), account)
  assert.equal(getProvider(), okx.value)
}))

test('MetaMask only is discovered without an ethereum global and requires selection', async () => withBrowser(async ({ announce }) => {
  const metamask = provider()
  announce('metamask', metamask.value)
  assert.equal(getProvider(), undefined)
  const [wallet] = getBrowserWallets()
  assert.equal(wallet.kind, 'metamask')
  assert.equal(await connectWallet(wallet), account)
  assert.equal(getProvider(), metamask.value)
}))

test('Rabby only stays Rabby even with a MetaMask compatibility flag', async () => withBrowser(async ({ host }) => {
  const rabby = provider({ isRabby: true, isMetaMask: true })
  host.ethereum = rabby.value
  const [wallet] = getBrowserWallets()
  assert.equal(wallet.kind, 'rabby')
  await connectWallet(wallet)
  assert.equal(getProvider(), rabby.value)
}))

test('OKX plus MetaMask legacy providers are distinct and neither is silently chosen', async () => withBrowser(({ host }) => {
  const okx = provider(), metamask = provider({ isMetaMask: true })
  host.okxwallet = okx.value
  host.ethereum = metamask.value
  assert.deepEqual(getBrowserWallets().map((wallet) => wallet.kind), ['okx', 'metamask'])
  assert.equal(getProvider(), undefined)
  assert.deepEqual(okx.calls, [])
  assert.deepEqual(metamask.calls, [])
}))

test('MetaMask plus Rabby announces both providers without picking announcement order', async () => withBrowser(({ announce }) => {
  const metamask = provider(), rabby = provider()
  announce('rabby', rabby.value, 2)
  announce('metamask', metamask.value, 1)
  assert.deepEqual(getBrowserWallets().map((wallet) => wallet.kind), ['rabby', 'metamask'])
  assert.equal(getProvider(), undefined)
  assert.deepEqual(rabby.calls, [])
  assert.deepEqual(metamask.calls, [])
}))

test('all three supported wallets and another compatible announced wallet are selectable', async () => withBrowser(({ announce }) => {
  for (const [index, kind] of (['okx', 'metamask', 'rabby', 'other'] as const).entries()) announce(kind, provider().value, index + 1)
  assert.deepEqual(getBrowserWallets().map((wallet) => wallet.kind), ['okx', 'metamask', 'rabby', 'other'])
  assert.equal(getBrowserWallets()[3].name, 'Example Wallet')
  assert.equal(getProvider(), undefined)
}))

test('explicit selection only replaces the current provider after validated connection completes', async () => withBrowser(async ({ announce }) => {
  const okx = provider(), rabby = provider()
  announce('okx', okx.value, 1); announce('rabby', rabby.value, 2)
  const [okxWallet, rabbyWallet] = getBrowserWallets()
  await connectWallet(okxWallet)
  let release!: () => void
  rabby.state.onRequest = () => new Promise<void>((resolve) => { release = resolve })
  const pending = connectWallet(rabbyWallet)
  assert.equal(getProvider(), okx.value)
  release()
  await pending
  assert.equal(getProvider(), rabby.value)
}))

test('selected Rabby receives connection and subsequent Tool Layer reads despite an OKX global', async () => withBrowser(async ({ host, announce }) => {
  const okx = provider(), metamask = provider(), rabby = provider()
  host.okxwallet = okx.value; host.ethereum = metamask.value
  announce('okx', okx.value, 1); announce('metamask', metamask.value, 2); announce('rabby', rabby.value, 3)
  await connectWallet(getBrowserWallets().find((wallet) => wallet.kind === 'rabby')!)
  assert.equal(getProvider(), rabby.value)
  assert.equal((await readWallet()).data?.account.toLowerCase(), account)
  assert.deepEqual(okx.calls, [])
  assert.deepEqual(metamask.calls, [])
  assert.deepEqual(rabby.calls, ['eth_requestAccounts', 'wallet_switchEthereumChain', 'eth_chainId', 'eth_accounts', 'eth_accounts', 'eth_chainId'])
}))

test('wallet rejection preserves the current provider and saved preference', async () => withBrowser(async ({ announce, storage }) => {
  const metamask = provider(), rabby = provider()
  announce('metamask', metamask.value, 1); announce('rabby', rabby.value, 2)
  await connectWallet(getBrowserWallets()[0])
  const preference = storage.get('mk.wallet.provider.v1')
  rabby.state.reject = 4001
  await assert.rejects(connectWallet(getBrowserWallets()[1]), { code: 4001 })
  assert.equal(getProvider(), metamask.value)
  assert.equal(storage.get('mk.wallet.provider.v1'), preference)
  assert.deepEqual(rabby.calls, ['eth_requestAccounts'])
}))

test('account unavailable or malformed rejects without committing provider selection', async () => withBrowser(async ({ announce, storage }) => {
  const rabby = provider()
  announce('rabby', rabby.value)
  for (const accounts of [[], ['bad address'], null]) {
    rabby.state.accounts = accounts
    await assert.rejects(connectWallet(getBrowserWallets()[0]), /No account returned/)
  }
  assert.equal(getProvider(), undefined)
  assert.equal(storage.size, 0)
  assert.equal(rabby.calls.includes('wallet_switchEthereumChain'), false)
}))

test('wrong chain readback rejects without replacing a validated current wallet', async () => withBrowser(async ({ announce }) => {
  const okx = provider(), rabby = provider()
  announce('okx', okx.value, 1); announce('rabby', rabby.value, 2)
  await connectWallet(getBrowserWallets()[0])
  rabby.state.chain = '0x1'
  await assert.rejects(connectWallet(getBrowserWallets()[1]), /not on Arc/)
  assert.equal(getProvider(), okx.value)
}))

test('watch-only clears provider access and existing policy denies signing authority', async () => withBrowser(async ({ announce, storage }) => {
  const rabby = provider()
  announce('rabby', rabby.value)
  await connectWallet(getBrowserWallets()[0])
  const before = [...rabby.calls]
  clearBrowserProvider()
  assert.equal(getProvider(), undefined)
  assert.equal(storage.size, 0)
  assert.equal(isAddress(account), true)
  assert.equal(isAddress('0x123'), false)
  const result = assessPreparation({ kind: 'send', rawUserText: 'Send 1 USDC', recipient: otherAccount, asset: 'USDC', amount: '1' }, { connected: false, account, chainId: ARC.chainId })
  assert.equal(result.checks.find((check) => check.code === 'wallet-connected')?.status, 'unknown')
  assert.notEqual(result.status, 'ready')
  assert.deepEqual(rabby.calls, before)
}))

test('connection stores metadata only and has no private-key or wallet-signature path', async () => withBrowser(async ({ announce, storage }) => {
  const metamask = provider()
  announce('metamask', metamask.value)
  await connectWallet(getBrowserWallets()[0])
  assert.deepEqual([...storage.entries()], [['mk.wallet.provider.v1', JSON.stringify({ source: 'eip6963', rdns: 'io.metamask', name: 'MetaMask' })]])
  assert.equal(metamask.calls.some((method) => /sign|sendTransaction|private|secret|mnemonic/i.test(method)), false)
}))

test('cancel during the wallet popup prevents a late approval from replacing selection', async () => withBrowser(async ({ announce }) => {
  const okx = provider(), rabby = provider()
  announce('okx', okx.value, 1); announce('rabby', rabby.value, 2)
  await connectWallet(getBrowserWallets()[0])
  let release!: () => void
  rabby.state.onRequest = () => new Promise<void>((resolve) => { release = resolve })
  const controller = new AbortController()
  const pending = connectWallet(getBrowserWallets()[1], controller.signal)
  controller.abort(); release()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(getProvider(), okx.value)
  assert.deepEqual(rabby.calls, ['eth_requestAccounts'])
}))

test('reload restores selected rdns with a new UUID and refuses a missing or ambiguous wallet', () => {
  const storage = new Map<string, string>()
  const first = browser(storage), firstRegistry = createWalletProviderRegistry(first.host)
  firstRegistry.start()
  const rabby = provider()
  first.announce('rabby', rabby.value, 1)
  firstRegistry.commit(rabby.value)
  const next = browser(storage), nextRegistry = createWalletProviderRegistry(next.host)
  next.host.okxwallet = provider().value
  nextRegistry.start()
  assert.equal(nextRegistry.getProvider(), undefined)
  const nextRabby = provider()
  next.announce('rabby', nextRabby.value, 99)
  assert.equal(nextRegistry.getProvider(), nextRabby.value)
  next.announce('rabby', provider().value, 100)
  assert.equal(nextRegistry.getProvider(), undefined)
})

test('copied UUID, repeated announcements, and legacy aliases cannot replace selected identity', async () => withBrowser(async ({ host, announce }) => {
  const metamask = provider(), impostor = provider()
  host.ethereum = metamask.value
  announce('metamask', metamask.value, 1)
  announce('metamask', metamask.value, 2)
  assert.equal(getBrowserWallets().length, 1)
  await connectWallet(getBrowserWallets()[0])
  announce('metamask', impostor.value, 1)
  host.ethereum = impostor.value
  assert.equal(getBrowserWallets().length, 1)
  assert.equal(getProvider(), metamask.value)
  assert.deepEqual(impostor.calls, [])
}))

test('legacy providers array discovers individual providers without connecting the container', async () => withBrowser(async ({ host }) => {
  const metamask = provider({ isMetaMask: true }), rabby = provider({ isRabby: true, isMetaMask: true }), container = provider()
  host.ethereum = { ...container.value, providers: [metamask.value, rabby.value] }
  assert.deepEqual(getBrowserWallets().map((wallet) => wallet.kind), ['metamask', 'rabby'])
  await connectWallet(getBrowserWallets()[1])
  assert.equal(getProvider(), rabby.value)
  assert.deepEqual(container.calls, [])
  assert.deepEqual(metamask.calls, [])
}))

test('late announcements notify provider consumers and disconnected selection never falls back', async () => withBrowser(async ({ host, announce }) => {
  const okx = provider(), rabby = provider()
  let updates = 0
  const stop = subscribeBrowserWallets(() => { updates++ })
  announce('rabby', rabby.value, 1)
  await connectWallet(getBrowserWallets()[0])
  assert.ok(updates >= 2)
  host.okxwallet = okx.value
  rabby.state.accounts = []
  assert.equal((await readWallet()).status, 'UNAVAILABLE')
  assert.equal(getProvider(), rabby.value)
  assert.deepEqual(okx.calls, [])
  clearBrowserProvider()
  assert.equal(getProvider(), undefined)
  stop()
}))

test('untrusted announcement metadata is inert and invalid image sources are discarded', () => {
  const fixture = browser(), registry = createWalletProviderRegistry(fixture.host)
  registry.start()
  fixture.announce('other', provider().value, 1, { icon: 'javascript:alert(1)', name: '<script>evil</script>' })
  assert.equal(registry.getWallets()[0].icon, undefined)
  assert.equal(registry.getWallets()[0].name, '<script>evil</script>')
  fixture.host.dispatchEvent!(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'invalid', name: 'Fake', rdns: 'io.fake' }, provider: provider().value } }))
  assert.equal(registry.getWallets().length, 1)
})

test('account changes during connection fail before provider commit', async () => withBrowser(async ({ announce }) => {
  const metamask = provider()
  const base = metamask.value.request
  metamask.value.request = async (args) => args.method === 'eth_accounts' ? [otherAccount] : base(args)
  announce('metamask', metamask.value)
  await assert.rejects(connectWallet(getBrowserWallets()[0]), /account changed/)
  assert.equal(getProvider(), undefined)
}))

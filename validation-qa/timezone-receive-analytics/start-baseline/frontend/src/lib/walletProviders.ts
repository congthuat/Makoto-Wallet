/** Browser discovery stores provider references, never keys or signing authority. */
export type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<any>
  on?: (event: string, callback: (...args: any[]) => void) => void
  removeListener?: (event: string, callback: (...args: any[]) => void) => void
}

type InjectedProvider = Eip1193 & { isMetaMask?: boolean; isRabby?: boolean; isOkxWallet?: boolean; isOKExWallet?: boolean; providers?: InjectedProvider[] }
export type WalletKind = 'okx' | 'metamask' | 'rabby' | 'other'
export type BrowserWallet = {
  id: string
  name: string
  kind: WalletKind
  source: 'eip6963' | 'legacy'
  provider: Eip1193
  rdns?: string
  icon?: string
}
type Preference = { source: 'eip6963'; rdns: string; name: string } | { source: 'legacy'; kind: WalletKind }
export type WalletBrowserHost = {
  ethereum?: InjectedProvider
  okxwallet?: InjectedProvider
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  addEventListener?: (name: string, callback: EventListener) => void
  dispatchEvent?: (event: Event) => boolean
}

declare global {
  interface Window { ethereum?: InjectedProvider; okxwallet?: InjectedProvider }
}

const preferenceKey = 'mk.wallet.provider.v1'
const names: Record<WalletKind, string> = { okx: 'OKX Wallet', metamask: 'MetaMask', rabby: 'Rabby', other: 'Other browser wallet' }
const isProvider = (value: unknown): value is InjectedProvider => !!value && typeof value === 'object' && typeof (value as Eip1193).request === 'function'
const walletKind = (provider: InjectedProvider, rdns?: string): WalletKind => {
  if (rdns === 'com.okex.wallet' || rdns === 'com.okx.wallet') return 'okx'
  if (rdns === 'io.rabby') return 'rabby'
  if (rdns === 'io.metamask') return 'metamask'
  if (rdns) return 'other'
  // Rabby and other wallets may also advertise isMetaMask for compatibility.
  if (provider.isRabby) return 'rabby'
  if (provider.isOkxWallet || provider.isOKExWallet) return 'okx'
  if (provider.isMetaMask) return 'metamask'
  return 'other'
}

function readPreference(host: WalletBrowserHost): Preference | undefined {
  try {
    const value = JSON.parse(host.localStorage?.getItem(preferenceKey) ?? 'null')
    if (value?.source === 'eip6963' && typeof value.rdns === 'string' && typeof value.name === 'string') return value
    if (value?.source === 'legacy' && ['okx', 'metamask', 'rabby', 'other'].includes(value.kind)) return value
  } catch { /* A damaged preference cannot authorize a different wallet. */ }
}

/** Metadata is presentation only; rdns is not proof of wallet identity. */
export function createWalletProviderRegistry(host: WalletBrowserHost) {
  const announced = new Map<string, BrowserWallet>()
  const listeners = new Set<() => void>()
  let options: BrowserWallet[] = []
  let revision = 0
  let started = false
  let selected: Eip1193 | undefined
  let preference = readPreference(host)
  let cleared = false
  const publish = () => { revision++; listeners.forEach((listener) => listener()) }
  const refresh = () => {
    const next = [...announced.values()]
    const legacy = [host.okxwallet, ...(Array.isArray(host.ethereum?.providers) ? host.ethereum.providers : []), host.ethereum]
    for (const provider of legacy) {
      if (!isProvider(provider) || next.some((entry) => entry.provider === provider)) continue
      // A multi-provider container is not itself an independently selectable wallet.
      if (provider === host.ethereum && Array.isArray(provider.providers) && provider.providers.length) continue
      const kind = provider === host.okxwallet ? 'okx' : walletKind(provider)
      // Prefer announced interfaces over mutable compatibility aliases. Unknown
      // global aliases cannot safely identify an additional wallet once discovery works.
      if (announced.size && (kind === 'other' || next.some((entry) => entry.source === 'eip6963' && entry.kind === kind))) continue
      const count = next.filter((entry) => entry.source === 'legacy' && entry.kind === kind).length
      next.push({ id: `legacy:${kind}:${count}`, name: names[kind], kind, source: 'legacy', provider })
    }
    if (next.length !== options.length || next.some((entry, index) => entry.provider !== options[index]?.provider || entry.id !== options[index]?.id)) {
      options = next
      publish()
    }
  }
  const onAnnouncement: EventListener = (event) => {
    const detail = (event as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    const { info, provider } = detail as { info?: Record<string, unknown>; provider?: unknown }
    if (!info || !isProvider(provider)) return
    const { uuid, name, rdns, icon } = info
    if (typeof uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) return
    if (typeof name !== 'string' || !name.trim() || name.length > 128 || typeof rdns !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(rdns)) return
    // Re-announcements cannot replace another provider under a copied UUID.
    if (announced.has(uuid) || [...announced.values()].some((entry) => entry.provider === provider)) return
    // Render data images only through <img>; never inject a wallet's SVG markup.
    const safeIcon = typeof icon === 'string' && icon.length < 100_000 && /^data:image\/(?:png|jpeg|webp|gif|svg\+xml)[;,]/i.test(icon) ? icon : undefined
    announced.set(uuid, { id: uuid, name: name.trim(), rdns, icon: safeIcon, kind: walletKind(provider, rdns), source: 'eip6963', provider })
    refresh()
  }
  const start = () => {
    if (!started) {
      started = true
      host.addEventListener?.('eip6963:announceProvider', onAnnouncement)
    }
    refresh()
    host.dispatchEvent?.(new Event('eip6963:requestProvider'))
  }
  const getProvider = () => {
    refresh()
    if (selected) return selected
    if (cleared) return undefined
    if (preference) {
      const matches = options.filter((entry) => preference?.source === 'eip6963'
        ? entry.source === 'eip6963' && entry.rdns === preference.rdns && entry.name === preference.name
        : entry.source === 'legacy' && entry.kind === preference?.kind)
      return matches.length === 1 ? matches[0].provider : undefined
    }
    // Compatibility for pre-picker sessions with one legacy provider only.
    // Announced providers always require selection; never pick the first wallet.
    return announced.size === 0 && options.length === 1 ? options[0].provider : undefined
  }
  const commit = (provider: Eip1193) => {
    refresh()
    const entry = options.find((wallet) => wallet.provider === provider)
    if (!entry) throw new Error('Wallet provider is no longer available.')
    selected = provider
    cleared = false
    preference = entry.source === 'eip6963' ? { source: 'eip6963', rdns: entry.rdns!, name: entry.name } : { source: 'legacy', kind: entry.kind }
    try { host.localStorage?.setItem(preferenceKey, JSON.stringify(preference)) } catch { /* Session selection still works without storage. */ }
    publish()
  }
  const clear = () => {
    selected = undefined
    preference = undefined
    cleared = true
    try { host.localStorage?.removeItem(preferenceKey) } catch { /* Clear session authority even when storage is unavailable. */ }
    publish()
  }
  return {
    start, getProvider, commit, clear,
    getWallets: () => { refresh(); return options },
    hasProvider: (provider: Eip1193) => { refresh(); return options.some((entry) => entry.provider === provider) },
    revision: () => revision,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

const registries = new WeakMap<object, ReturnType<typeof createWalletProviderRegistry>>()
function currentRegistry() {
  if (typeof window === 'undefined') return undefined
  let registry = registries.get(window)
  if (!registry) {
    registry = createWalletProviderRegistry(window)
    registries.set(window, registry)
    registry.start()
  }
  return registry
}

export const discoverBrowserWallets = () => { currentRegistry()?.start() }
export const getBrowserWallets = (): BrowserWallet[] => currentRegistry()?.getWallets() ?? []
export const getProvider = (): Eip1193 | undefined => currentRegistry()?.getProvider()
export const hasBrowserProvider = (provider: Eip1193) => currentRegistry()?.hasProvider(provider) ?? false
export const commitBrowserProvider = (provider: Eip1193) => { currentRegistry()?.commit(provider) }
export const clearBrowserProvider = () => { currentRegistry()?.clear() }
export const subscribeBrowserWallets = (listener: () => void) => currentRegistry()?.subscribe(listener) ?? (() => {})
export const browserWalletRevision = () => currentRegistry()?.revision() ?? 0

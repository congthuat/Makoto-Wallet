import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { checkSendReceipt, parseSendAmount, type SendRecord } from './sendExecution'
import { mergeSendRecord, sendActivityStatus } from './activity'
import { checkBridgeRecord, checkSwapRecord, mergeBridgeRecord, mergeSwapRecord, type BridgeRecord, type SwapRecord } from './protocolActivity'
import { taskApi, type TaskCandidate, type TaskStatus } from './tasks'
import { taskAuthApi } from './taskAuth'
import { valuePortfolio } from '../../../shared/portfolioValuation.mjs'
import { captureEligible, historyPoints, historyQueryKey, historyScope, portfolioHistoryApi } from './portfolioHistory'
import {
  DEMO_ACTIVITY, DEMO_ADDRESS, DEMO_BALANCES, TOKENS, connectWallet, getProvider,
  type Contact, type Holding, type NetworkInfo, type Prices, type Tx, type WalletApi,
} from './wallet'

export type Page = 'home' | 'agent' | 'tasks' | 'dashboard' | 'assets' | 'activity' | 'send' | 'swap' | 'bridge' | 'settings' | 'insights' | 'audit' | 'faucet' | 'about' | 'legal' | 'changelog' | 'status'

export type FeedTx = {
  hash: string; logIndex: number; block: number; timestamp: string; from: string | null; to: string | null
  fromName: string | null; toName: string | null; fromContract: boolean; toContract: boolean; symbol: string; amount: number; method: string | null
}
export type Feed = { live: FeedTx[]; whales: FeedTx[]; sampled: number; sampledVolume: number; updatedAt: number }

export type Mode = 'demo' | 'watch' | 'connected'

export type Settings = {
  hideSmall: boolean
  hideSpam: boolean
  txAlerts: boolean
  confirmLarge: boolean
  vivid?: boolean
}

function useLocal<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
  }, [key, v])
  return [v, setV] as const
}

type Ctx = ReturnType<typeof useWalletState>
const WalletCtx = createContext<Ctx | null>(null)
export const useWallet = () => {
  const c = useContext(WalletCtx)
  if (!c) throw new Error('WalletProvider missing')
  return c
}

function useWalletState() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState<Page>(() => { if (typeof window === 'undefined') return 'home'; const h = window.location.hash.slice(1); return (['audit', 'about', 'legal', 'changelog', 'status', 'faucet'] as string[]).includes(h) ? (h as Page) : 'home' })
  const [hidden, setHidden] = useLocal('mk.hidden', false)
  const [mode, setMode] = useLocal<Mode>('mk.mode', 'demo')
  const [address, setAddress] = useLocal<string>('mk.address', '')
  const [walletChainId, setWalletChainId] = useState<number | undefined>()
  const [walletAccountConfirmed, setWalletAccountConfirmed] = useState(false)
  const authQuery = useQuery({ queryKey: ['task-session'], queryFn: taskAuthApi.session, retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 })
  const taskSessionAddress = authQuery.data?.authenticated ? authQuery.data.address : null
  const taskAuthenticated = mode === 'connected' && walletAccountConfirmed && !!address && taskSessionAddress?.toLowerCase() === address.toLowerCase()
  const taskQuery = useQuery({ queryKey: ['tasks', taskSessionAddress, address], queryFn: taskApi.list, enabled: taskAuthenticated, refetchInterval: 15_000, retry: 1 })
  const notificationQuery = useQuery({ queryKey: ['task-notifications', taskSessionAddress, address], queryFn: taskApi.notifications, enabled: taskAuthenticated, refetchInterval: 15_000, retry: 1 })
  const tasks = taskAuthenticated ? taskQuery.data?.tasks ?? [] : []
  const taskNotifications = taskAuthenticated ? notificationQuery.data?.notifications ?? [] : []
  useEffect(() => {
    if (!taskAuthenticated) {
      queryClient.removeQueries({ queryKey: ['tasks'] })
      queryClient.removeQueries({ queryKey: ['task-notifications'] })
    }
  }, [taskAuthenticated, queryClient])
  const [contacts, setContacts] = useLocal<Contact[]>('mk.contacts', [])
  const [settings, setSettings] = useLocal<Settings>('mk.settings', {
    hideSmall: false, hideSpam: true, txAlerts: true, confirmLarge: true,
  })
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [txDetail, setTxDetail] = useState<Tx | null>(null)
  const [sendDraft, setSendDraft] = useState<{ to?: string; amount?: string; symbol?: string; review?: boolean } | null>(null)
  const [sendRecords, setSendRecords] = useLocal<SendRecord[]>('mk.send.records.v1', [])
  const [swapRecords, setSwapRecords] = useLocal<SwapRecord[]>('mk.swap.records.v1', [])
  const [bridgeRecords, setBridgeRecords] = useLocal<BridgeRecord[]>('mk.bridge.records.v1', [])
  const upsertBridge = useCallback((record: BridgeRecord) => setBridgeRecords((old) => {
    const safe = Array.isArray(old) ? old : []
    const previous = safe.find((item) => item.hash?.toLowerCase() === record.hash.toLowerCase())
    return [mergeBridgeRecord(previous, record), ...safe.filter((item) => item.hash?.toLowerCase() !== record.hash.toLowerCase())].slice(0, 100)
  }), [setBridgeRecords])
  const upsertSwap = useCallback((record: SwapRecord) => setSwapRecords((old) => {
    const safe = Array.isArray(old) ? old : []
    const previous = safe.find((item) => item.hash?.toLowerCase() === record.hash.toLowerCase())
    return [mergeSwapRecord(previous, record), ...safe.filter((item) => item.hash?.toLowerCase() !== record.hash.toLowerCase())].slice(0, 100)
  }), [setSwapRecords])
  const upsertSend = useCallback((record: SendRecord) => setSendRecords((old) => {
    const previous = old.find((x) => x.hash.toLowerCase() === record.hash.toLowerCase())
    return [mergeSendRecord(previous, record), ...old.filter((x) => x.hash.toLowerCase() !== record.hash.toLowerCase())].slice(0, 100)
  }), [setSendRecords])
  useEffect(() => {
    if (mode !== 'connected' || !address) return
    const p = getProvider()
    if (!p) return
    const reconcile = async () => {
      try {
        const chain = await p.request({ method: 'eth_chainId' })
        if (Number(chain) !== 5042002) return
        for (const record of sendRecords.filter((r) => r.account.toLowerCase() === address.toLowerCase() && (r.status === 'pending' || r.status === 'unknown'))) {
          const token = TOKENS.find((x) => x.sym === record.symbol)
          if (!token) continue
          const result = await checkSendReceipt(p, record.hash, { token, account: record.account, recipient: record.recipient, units: parseSendAmount(record.amount, token.decimals) })
          if (result === 'confirmed' || result === 'failed') upsertSend({ ...record, status: result === 'confirmed' ? 'completed' : 'failed' })
        }
      } catch { /* Keep the last evidence-based state for later recovery. */ }
    }
    void reconcile()
    const timer = setInterval(() => { void reconcile() }, 20_000)
    return () => clearInterval(timer)
  }, [mode, address, sendRecords, upsertSend])
  useEffect(() => {
    if (mode !== 'connected' || !address) return
    const p = getProvider(); if (!p) return
    const reconcile = async () => {
      try {
        const chain = await p.request({ method: 'eth_chainId' })
        if (Number(chain) !== 5042002) return
        for (const record of (Array.isArray(swapRecords) ? swapRecords : []).filter((item) => item.account?.toLowerCase() === address.toLowerCase() && (item.status === 'pending' || item.status === 'unknown'))) {
          const status = await checkSwapRecord(p, record)
          if (status === 'completed' || status === 'failed') upsertSwap({ ...record, status })
        }
      } catch { /* Keep unresolved evidence for a later read. */ }
    }
    void reconcile()
    const timer = setInterval(() => { void reconcile() }, 20_000)
    return () => clearInterval(timer)
  }, [mode, address, swapRecords, upsertSwap])
  useEffect(() => {
    if (mode !== 'connected' || !address) return
    const p = getProvider(); if (!p) return
    const reconcile = async () => {
      try {
        const chain = await p.request({ method: 'eth_chainId' })
        if (Number(chain) !== 5042002) return
        for (const record of (Array.isArray(bridgeRecords) ? bridgeRecords : []).filter((item) => item.account?.toLowerCase() === address.toLowerCase() && !['destination-confirmed', 'destination-failed', 'forwarding-failed', 'failed'].includes(item.status))) {
          const next = await checkBridgeRecord(p, record)
          if (next.status !== record.status || next.destinationHash !== record.destinationHash) upsertBridge(next)
        }
      } catch { /* Keep unresolved bridge evidence for a later read. */ }
    }
    void reconcile()
    const timer = setInterval(() => { void reconcile() }, 30_000)
    return () => clearInterval(timer)
  }, [mode, address, bridgeRecords, upsertBridge])
  const [swapDraft, setSwapDraft] = useState<{ from?: string; to?: string; amount?: string; dest?: string } | null>(null)
  const [agentSeed, setAgentSeed] = useState<string | null>(null)
  const [agentSeedMode, setAgentSeedMode] = useState<'monitor' | 'automation' | null>(null)
  const [lockPreview, setLockPreview] = useState(false)

  const notify = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => setToast({ msg, kind }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const prices = useQuery<Prices>({
    queryKey: ['prices'],
    queryFn: () => fetch(api('prices')).then((r) => r.json()),
    refetchInterval: 60_000,
  })
  const network = useQuery<NetworkInfo>({
    queryKey: ['arc-network'],
    queryFn: async () => {
      const r = await fetch(api('arc/network'))
      if (!r.ok) throw new Error('network')
      return r.json()
    },
    refetchInterval: 12_000,
  })
  const feed = useQuery<Feed>({
    queryKey: ['arc-feed'],
    queryFn: async () => {
      const r = await fetch(api('arc/feed'))
      if (!r.ok) throw new Error('feed')
      return r.json()
    },
    enabled: page === 'insights',
    refetchInterval: 15_000,
  })
  const live = mode !== 'demo' && !!address
  const wallet = useQuery<WalletApi>({
    queryKey: ['arc-wallet', address],
    enabled: live,
    queryFn: async () => {
      const r = await fetch(api(`arc/wallet?address=${address}`))
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error ?? 'wallet')
      return j
    },
    refetchInterval: 20_000,
  })

  // React to account changes in the extension
  useEffect(() => {
    if (mode !== 'connected') { setWalletAccountConfirmed(false); return }
    const p = getProvider()
    if (!p) { setWalletAccountConfirmed(false); return }
    let active = true
    setWalletAccountConfirmed(false)
    p.request({ method: 'eth_accounts' }).then((accounts) => {
      if (!active) return
      const current = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : ''
      if (!current) { setMode('demo'); setAddress(''); return }
      if (current.toLowerCase() !== address.toLowerCase()) setAddress(current)
      else setWalletAccountConfirmed(true)
    }).catch(() => { if (active) setWalletAccountConfirmed(false) })
    const onAccountsChanged = (acc: string[]) => {
      setWalletAccountConfirmed(false)
      if (acc?.[0]) setAddress(acc[0])
      else { setMode('demo'); setAddress('') }
    }
    p.on?.('accountsChanged', onAccountsChanged)
    return () => { active = false; p.removeListener?.('accountsChanged', onAccountsChanged) }
  }, [mode, address, setAddress, setMode])

  // Safety review must use the injected wallet's chain, not the backend's Arc status.
  useEffect(() => {
    if (mode !== 'connected') { setWalletChainId(undefined); return }
    const p = getProvider()
    if (!p) { setWalletChainId(undefined); return }
    let active = true
    const updateChain = (value: string) => {
      if (!active) return
      const chainId = Number(value)
      setWalletChainId(Number.isSafeInteger(chainId) && chainId > 0 ? chainId : undefined)
    }
    setWalletChainId(undefined)
    p.request({ method: 'eth_chainId' }).then(updateChain).catch(() => { if (active) setWalletChainId(undefined) })
    p.on?.('chainChanged', updateChain)
    return () => { active = false; p.removeListener?.('chainChanged', updateChain) }
  }, [mode, address])

  const connect = async () => {
    try {
      const a = await connectWallet()
      setWalletAccountConfirmed(true)
      setAddress(a); setMode('connected'); notify('Wallet connected · Arc network detected')
    } catch (e: any) {
      notify(e?.message ?? 'Connection failed', 'err')
    }
  }
  const watch = (a: string) => { setAddress(a.trim()); setMode('watch'); notify('Watch-only · displaying a public address') }
  const disconnect = () => { setMode('demo'); setAddress(''); notify('Disconnected — showing demo data') }

  const holdings: Holding[] = useMemo(() => {
    const p = prices.data
    const base = live
      ? (wallet.data?.tokens ?? []).map((t) => {
          const meta = TOKENS.find((m) => m.address.toLowerCase() === t.address.toLowerCase())
          return {
            symbol: meta?.sym ?? t.symbol, name: meta?.name ?? t.name, address: t.address, decimals: t.decimals,
            balance: t.balance, verified: t.verified, color: meta?.color ?? '#475569', glyph: meta?.glyph ?? (t.symbol?.[0] ?? '?'),
            priceKey: t.verified ? meta?.priceKey : undefined,
          }
        })
      : TOKENS.map((m) => ({
          symbol: m.sym, name: m.name, address: m.address, decimals: m.decimals, balance: DEMO_BALANCES[m.sym] ?? 0,
          verified: true, color: m.color, glyph: m.glyph, priceKey: m.priceKey,
        }))
    return base
      .map((h) => {
        const info = h.priceKey ? p?.[h.priceKey] : undefined
        const price = typeof info?.price === 'number' && Number.isFinite(info.price) && info.price > 0 ? info.price : undefined
        return { ...h, price, change24h: info?.change24h, history: info?.history, value: price == null ? undefined : h.balance * price }
      })
      .sort((a, b) => Number(b.verified) - Number(a.verified) || (b.value ?? 0) - (a.value ?? 0))
  }, [live, wallet.data, prices.data])

  const activity: Tx[] = useMemo(() => {
    if (!live) return DEMO_ACTIVITY
    const indexed: Tx[] = (wallet.data?.activity ?? []).map((a) => ({
      id: `${a.hash}-${a.logIndex}`,
      hash: a.hash,
      timestamp: new Date(a.timestamp).getTime(),
      direction: a.direction,
      counterparty: a.direction === 'in' ? a.from : a.to,
      counterpartyName: a.direction === 'in' ? a.fromName : a.toName,
      symbol: a.symbol,
      amount: a.amount,
      verified: a.verified,
      method: a.method,
      block: a.block,
      kind: (a.method === 'exchange' || /swap/i.test(a.fromName ?? a.toName ?? '') ? 'swap' : a.direction === 'in' ? 'receive' : 'send') as Tx['kind'],
      status: 'completed' as const, // indexed by the explorer = included in a block
    }))
    const local: Tx[] = sendRecords.filter((r) => r.account.toLowerCase() === address.toLowerCase() && r.chainId === 5042002 && !indexed.some((a) => a.hash?.toLowerCase() === r.hash.toLowerCase() && a.direction === 'out' && a.symbol === r.symbol && a.counterparty.toLowerCase() === r.recipient.toLowerCase() && a.amount === Number(r.amount))).map((r) => ({ id: r.hash, hash: r.hash, timestamp: r.timestamp, direction: 'out', counterparty: r.recipient, symbol: r.symbol, amount: Number(r.amount), verified: true, kind: 'send', status: sendActivityStatus(r.status) }))
    const swaps = (Array.isArray(swapRecords) ? swapRecords : []).filter((r) => r.account?.toLowerCase() === address.toLowerCase() && /^0x[0-9a-f]{64}$/i.test(r.hash)).map((r): Tx => ({ id: `swap-${r.hash}`, hash: r.hash, timestamp: r.timestamp, direction: 'out', counterparty: r.target, symbol: r.fromSymbol, amount: Number(r.amount), verified: true, kind: 'swap', status: r.status, route: `${r.fromSymbol} → ${r.toSymbol}`, toSymbol: r.toSymbol }))
    const swapHashes = new Set(swaps.map((record) => record.hash?.toLowerCase()))
    const bridges = (Array.isArray(bridgeRecords) ? bridgeRecords : []).filter((r) => r.account?.toLowerCase() === address.toLowerCase() && /^0x[0-9a-f]{64}$/i.test(r.hash)).map((r): Tx => ({ id: `bridge-${r.hash}`, hash: r.hash, timestamp: r.timestamp, direction: 'out', counterparty: r.target, counterpartyName: `Circle CCTP · ${r.status}`, symbol: 'USDC', amount: Number(r.amount), verified: true, kind: 'bridge', status: r.status === 'destination-confirmed' ? 'completed' : ['failed', 'destination-failed', 'forwarding-failed'].includes(r.status) ? 'failed' : r.status === 'source-unknown' ? 'unknown' : 'pending', route: 'Arc Testnet → Base Sepolia' }))
    const bridgeHashes = new Set(bridges.map((record) => record.hash?.toLowerCase()))
    return [...local, ...swaps, ...bridges, ...indexed.filter((record) => !swapHashes.has(record.hash?.toLowerCase()) && !bridgeHashes.has(record.hash?.toLowerCase()))].sort((a, b) => b.timestamp - a.timestamp)
  }, [live, wallet.data, sendRecords, swapRecords, bridgeRecords, address])

  const valuation = useMemo(() => valuePortfolio(holdings, prices.data), [holdings, prices.data])
  const total = valuation.totalUsd ?? 0
  // A partially priced portfolio must not be displayed as a complete total.
  // Zero holdings need no market price, but live holdings require a wallet read.
  const pricesReady = valuation.complete && (!live || wallet.isSuccess)
  const loading = (live && wallet.isLoading) || (!pricesReady && prices.isLoading)
  const walletError = live && wallet.isError ? (wallet.error as Error)?.message ?? 'Wallet data unavailable' : null
  const priceError = prices.isError || (prices.isSuccess && !pricesReady && (!live || wallet.isSuccess))
  const balanceError = walletError ? 'Wallet data unavailable' : priceError ? 'Pricing data is unavailable.' : null

  const portfolioScope = useMemo(() => historyScope({ mode, address, accountConfirmed: walletAccountConfirmed, chainId: walletChainId }), [mode, address, walletAccountConfirmed, walletChainId])
  const portfolioScopeKey = portfolioScope ? `${portfolioScope.walletAddress}:${portfolioScope.chainId}` : ''
  const captureSchedule = useRef(new Map<string, number>())
  const captureRequest = useRef<{ scopeKey: string; controller: AbortController } | null>(null)
  const activePortfolioScope = useRef(portfolioScopeKey)
  // Establish the local browser capability cookie before the first capture.
  const portfolioHistoryQuery = useQuery({
    queryKey: historyQueryKey(portfolioScope, '1d'),
    queryFn: ({ signal }) => portfolioHistoryApi.history(portfolioScope!, '1d', signal),
    enabled: !!portfolioScope, staleTime: 30_000, refetchInterval: 60_000, retry: 1,
  })
  useEffect(() => {
    activePortfolioScope.current = portfolioScopeKey
    if (captureRequest.current?.scopeKey !== portfolioScopeKey) {
      captureRequest.current?.controller.abort()
      captureRequest.current = null
    }
    return () => { captureRequest.current?.controller.abort() }
  }, [portfolioScopeKey])
  useEffect(() => {
    if (!portfolioScope || !portfolioHistoryQuery.isSuccess || document.visibilityState !== 'visible' || captureRequest.current || !captureEligible({
      scope: portfolioScope, wallet: wallet.data, balanceFailed: wallet.isError,
      complete: pricesReady, totalUsd: valuation.totalUsd, assets: valuation.assets,
    })) return
    const now = Date.now()
    const storedNext = Date.parse(portfolioHistoryQuery.data.nextCaptureAt ?? '')
    const scheduledNext = captureSchedule.current.get(portfolioScopeKey) ?? 0
    if (now < Math.max(scheduledNext, Number.isFinite(storedNext) ? storedNext : 0)) return
    const controller = new AbortController()
    captureRequest.current = { scopeKey: portfolioScopeKey, controller }
    // Failed reads get at most one attempt per minute, driven by existing polls.
    captureSchedule.current.set(portfolioScopeKey, now + 60_000)
    void portfolioHistoryApi.snapshot(portfolioScope, controller.signal).then((result) => {
      if (controller.signal.aborted || activePortfolioScope.current !== portfolioScopeKey) return
      const next = Date.parse(result.nextCaptureAt ?? '')
      captureSchedule.current.set(portfolioScopeKey, Math.max(now + 60_000, Number.isFinite(next) ? next : now + 60_000))
      if (result.status === 'SAVED' && result.wallet && result.prices) {
        // The displayed total uses the exact authoritative observation saved.
        queryClient.setQueryData(['arc-wallet', address], result.wallet)
        queryClient.setQueryData(['prices'], result.prices)
      }
      if (result.snapshot) void queryClient.invalidateQueries({ queryKey: historyQueryKey(portfolioScope) })
    }).catch(() => {
      // The independent GET query owns localized loading/error feedback.
    }).finally(() => {
      if (captureRequest.current?.controller === controller) captureRequest.current = null
    })
  }, [portfolioScope, portfolioScopeKey, portfolioHistoryQuery.isSuccess, portfolioHistoryQuery.data, pricesReady, valuation, wallet.data, wallet.dataUpdatedAt, wallet.isError, prices.dataUpdatedAt, queryClient, address])

  const refreshTasks = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['task-notifications'] })]) }
  const verifyTaskWallet = async () => {
    if (mode !== 'connected' || !walletAccountConfirmed || !address) throw new Error('AUTH_WALLET_REQUIRED')
    const session = await taskAuthApi.verifyWallet(address)
    queryClient.setQueryData(['task-session'], session)
    await refreshTasks()
  }
  const logoutTaskWallet = async () => {
    const session = await taskAuthApi.logout()
    queryClient.setQueryData(['task-session'], session)
    queryClient.removeQueries({ queryKey: ['tasks'] })
    queryClient.removeQueries({ queryKey: ['task-notifications'] })
  }
  const requireCurrentTaskSession = () => { if (!taskAuthenticated) throw new Error('AUTH_REQUIRED') }
  const createTask = async (candidate: TaskCandidate) => {
    requireCurrentTaskSession()
    if (candidate.account.toLowerCase() !== address.toLowerCase()) throw new Error('TASK_ACCOUNT_MISMATCH')
    const result = await taskApi.create(candidate); await refreshTasks(); return result.task
  }
  const updateTask = async (id: string, change: Partial<Pick<TaskCandidate, 'condition' | 'schedule'>> & { status?: TaskStatus }) => { requireCurrentTaskSession(); const result = await taskApi.update(id, change); await refreshTasks(); return result.task }
  const deleteTask = async (id: string) => { requireCurrentTaskSession(); await taskApi.remove(id); await refreshTasks() }
  const runTask = async (id: string) => { requireCurrentTaskSession(); try { return await taskApi.run(id) } finally { await refreshTasks() } }

  const displayAddress = live ? address : DEMO_ADDRESS
  const mask = (s: string) => (hidden ? '••••••' : s)
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  return {
    page, go, hidden, setHidden, mask, mode, address, walletChainId, displayAddress, live, connect, watch, disconnect,
    contacts, setContacts, settings, setSettings, toast, notify,
    receiveOpen, setReceiveOpen, txDetail, setTxDetail, sendDraft, setSendDraft, swapDraft, setSwapDraft, agentSeed, setAgentSeed, agentSeedMode, setAgentSeedMode, lockPreview, setLockPreview,
    sendRecords, upsertSend, swapRecords, upsertSwap, bridgeRecords, upsertBridge,
    prices: prices.data, network: network.data, networkError: network.isError,
    walletError, balanceError,
    holdings, activity, total, pricesReady, loading, portfolioScope,
    portfolioDayPoints: historyPoints(portfolioHistoryQuery.data, portfolioScope),
    portfolioHistoryReady: portfolioHistoryQuery.isSuccess, portfolioHistoryError: portfolioHistoryQuery.isError,
    txCount: wallet.data?.txCount ?? null,
    walletRefreshing: wallet.isFetching,
    refetchWallet: () => wallet.refetch(),
    refetchBalance: () => walletError ? wallet.refetch() : prices.refetch(),
    tasks, tasksLoading: taskAuthenticated && taskQuery.isLoading, tasksError: taskAuthenticated && taskQuery.isError, refreshTasks, createTask, updateTask, deleteTask, runTask,
    taskAuthenticated, taskSessionAddress, taskWalletReady: walletAccountConfirmed, taskAuthLoading: authQuery.isLoading, taskAuthError: authQuery.isError, verifyTaskWallet, logoutTaskWallet,
    taskNotifications, taskNotificationsLoading: notificationQuery.isLoading, taskNotificationsError: notificationQuery.isError,
    feed: feed.data, feedError: feed.isError,
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const v = useWalletState()
  return <WalletCtx.Provider value={v}>{children}</WalletCtx.Provider>
}

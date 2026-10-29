import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUp, Maximize2, Square, X } from 'lucide-react'
import { useWallet } from '../lib/store'
import { useT } from '../lib/i18n'
import { ARC } from '../lib/wallet'
import { Orb, T } from './wallet/ui'
import { AgentMarkdown } from './AgentMarkdown'
import { requestMakotoChatStream, visibleStreamText, type ChatHistoryItem } from '../agent/chatClient'
import { appendChatHistory } from '../agent/chatContext'
import { routeAgentMessage } from '../agent/chatRouter'
import { loadAgentMemory, memoryForRequest } from '../lib/agentMemory'

const POS_KEY = 'mk.agent.bubble.v1'
const SIZE = 60
const MARGIN = 12
const DRAG_THRESHOLD = 5
const GREET_KEY = 'mk.agent.greeted'

type Pos = { x: number; y: number }
type MiniMsg = { id: number; role: 'user' | 'agent'; text: string; needsReview?: boolean; question?: string; streaming?: boolean; status?: string }

const clamp = (pos: Pos): Pos => {
  if (typeof window === 'undefined') return pos
  const maxX = window.innerWidth - SIZE - MARGIN
  const maxY = window.innerHeight - SIZE - MARGIN
  return { x: Math.min(Math.max(MARGIN, pos.x), Math.max(MARGIN, maxX)), y: Math.min(Math.max(MARGIN, pos.y), Math.max(MARGIN, maxY)) }
}
const defaultPos = (): Pos => {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  // Above the mobile tab bar; bottom-right on desktop.
  const bottom = window.innerWidth < 1024 ? 96 : 28
  return clamp({ x: window.innerWidth - SIZE - 24, y: window.innerHeight - SIZE - bottom })
}
const loadPos = (): Pos => {
  try {
    const saved = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as Pos | null
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return clamp(saved)
  } catch { /* use default */ }
  return defaultPos()
}

let mid = 0

/** A small Makoto Agent bubble on every page. Drag it anywhere; tap it to chat. */
export default function FloatingAgent() {
  const w = useWallet()
  const [tr, lang] = useT()
  const vi = lang === 'vi'
  const [pos, setPos] = useState<Pos>(() => (typeof window === 'undefined' ? { x: 0, y: 0 } : loadPos()))
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<MiniMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null)
  const history = useRef<ChatHistoryItem[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLButtonElement>(null)
  const [greeting, setGreeting] = useState(false)

  // Say hello once a day, a moment after the page settles.
  useEffect(() => {
    let today = ''
    try {
      today = new Date().toDateString()
      if (localStorage.getItem(GREET_KEY) === today) return
    } catch { return }
    const show = window.setTimeout(() => {
      setGreeting(true)
      try { localStorage.setItem(GREET_KEY, today) } catch { /* ignore */ }
    }, 2500)
    const hide = window.setTimeout(() => setGreeting(false), 9500)
    return () => { window.clearTimeout(show); window.clearTimeout(hide) }
  }, [])
  useEffect(() => { if (open || dragging) setGreeting(false) }, [open, dragging])

  useEffect(() => {
    const onResize = () => setPos((current) => clamp(current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [msgs])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    // Clicking anywhere outside the chat (and outside the bubble) closes it.
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || panelRef.current?.contains(target) || bubbleRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onOutside)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onOutside) }
  }, [open])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    drag.current = { startX: event.clientX, startY: event.clientY, originX: pos.x, originY: pos.y, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!d.moved) { d.moved = true; setDragging(true) }
    setPos(clamp({ x: d.originX + dx, y: d.originY + dy }))
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!d) return
    if (d.moved) {
      setDragging(false)
      setPos((current) => { try { localStorage.setItem(POS_KEY, JSON.stringify(current)) } catch { /* ignore */ } return current })
    } else setOpen((value) => !value)
  }

  const openFull = (question?: string) => {
    if (question) { w.setAgentSeedMode(null); w.setAgentSeed(question) }
    setOpen(false)
    w.go('agent')
  }

  const ask = async (raw: string) => {
    const q = raw.trim()
    if (!q || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    const userMsg: MiniMsg = { id: ++mid, role: 'user', text: q }
    const replyId = ++mid
    setMsgs((m) => [...m, userMsg, { id: replyId, role: 'agent', text: '', streaming: true }])
    setInput('')
    setBusy(true)
    const prior = history.current
    history.current = appendChatHistory(prior, { role: 'user', content: q })
    let streamed = ''
    const update = (patch: Partial<MiniMsg>) => setMsgs((m) => m.map((x) => (x.id === replyId ? { ...x, ...patch } : x)))
    try {
      const response = await requestMakotoChatStream({
        message: q,
        topic: routeAgentMessage(q, vi ? 'vi' : 'en').topic,
        history: prior,
        context: { locale: lang, mode: w.mode, ...(w.mode === 'connected' ? { chain: ARC.name as 'Arc Testnet' } : {}), intent: 'INFORMATION' },
        address: w.mode !== 'demo' ? w.address : undefined,
        memory: memoryForRequest(loadAgentMemory(typeof localStorage === 'undefined' ? undefined : localStorage), w.contacts),
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'delta') { streamed += event.text; update({ text: visibleStreamText(streamed), status: undefined }) }
          else update({ status: tr(event.source ?? event.tool) })
        },
      })
      if (response.ok) {
        const needsReview = Boolean(response.proposal || response.plan || response.task)
        update({ text: response.text, streaming: false, status: undefined, needsReview, question: q })
        history.current = appendChatHistory(history.current, { role: 'assistant', content: response.text })
      } else if (response.aborted) {
        update({ text: visibleStreamText(streamed) || (vi ? 'Đã dừng.' : 'Stopped.'), streaming: false, status: undefined })
      } else {
        update({ text: vi ? 'Agent đang bận, bạn thử lại sau ít phút nhé.' : 'The Agent is busy. Please try again in a few minutes.', streaming: false, status: undefined })
      }
    } catch {
      update({ text: vi ? 'Agent đang bận, bạn thử lại sau ít phút nhé.' : 'The Agent is busy. Please try again in a few minutes.', streaming: false, status: undefined })
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  // The full Agent page already has the chat.
  if (w.page === 'agent') return null

  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 800 : window.innerHeight
  const mobile = viewportW < 640
  const panelW = 380
  const panelH = Math.min(540, viewportH - 2 * MARGIN)
  // Desktop: open beside the bubble, on whichever side has room.
  const panelLeft = Math.min(Math.max(MARGIN, pos.x + SIZE / 2 > viewportW / 2 ? pos.x + SIZE - panelW : pos.x), viewportW - panelW - MARGIN)
  const panelTop = pos.y > viewportH / 2 ? Math.max(MARGIN, pos.y - panelH - 10) : Math.min(pos.y + SIZE + 10, viewportH - panelH - MARGIN)
  const hour = new Date().getHours()
  const greetText = vi
    ? (hour < 11 ? 'Chào buổi sáng 👋' : hour < 18 ? 'Chào buổi chiều 👋' : 'Chào buổi tối 👋')
    : (hour < 12 ? 'Good morning 👋' : hour < 18 ? 'Good afternoon 👋' : 'Good evening 👋')
  const greetOnLeft = pos.x + SIZE / 2 > viewportW / 2
  const suggestions = vi
    ? ['Bản tin hôm nay', 'Giá BTC bây giờ?', 'Lãi lỗ ví 7 ngày']
    : ['Morning briefing for today', 'BTC price now?', 'Wallet profit and loss over 7 days']

  return (
    <>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Makoto Agent"
          className={`fixed z-[46] flex flex-col overflow-hidden border border-white/[0.08] bg-[#17171d] shadow-2xl mk-in ${mobile ? 'inset-x-2 bottom-2 rounded-2xl' : 'rounded-2xl'}`}
          style={mobile ? { height: Math.min(560, viewportH - 80) } : { left: panelLeft, top: panelTop, width: panelW, height: panelH }}
        >
          <div className="flex items-center gap-2.5 px-3.5 h-14 border-b border-white/[0.06] shrink-0">
            <Orb size={28} glow={false} thinking={busy} />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold">Makoto Agent</div>
              <div className={`text-[11.5px] ${T.mute}`}>{vi ? 'Hỏi nhanh ở bất kỳ trang nào' : 'Quick help on any page'}</div>
            </div>
            <button type="button" onClick={() => openFull()} title={vi ? 'Mở trang Agent đầy đủ' : 'Open full Agent'} aria-label={vi ? 'Mở trang Agent đầy đủ' : 'Open full Agent'} className={`h-8 w-8 inline-flex items-center justify-center rounded-lg ${T.sub} hover:text-white hover:bg-white/[0.06]`}><Maximize2 size={15} /></button>
            <button type="button" onClick={() => setOpen(false)} aria-label={vi ? 'Đóng' : 'Close'} className={`h-8 w-8 inline-flex items-center justify-center rounded-lg ${T.sub} hover:text-white hover:bg-white/[0.06]`}><X size={16} /></button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 space-y-3">
            {!msgs.length && (
              <div className="pt-4 text-center">
                <div className="flex justify-center"><Orb size={46} float /></div>
                <p className="mt-3 text-[14px] font-semibold">{vi ? 'Mình giúp gì cho bạn?' : 'How can I help?'}</p>
                <p className={`mt-1 text-[12.5px] ${T.mute}`}>{vi ? 'Giữ chuột vào nút tròn để kéo đi chỗ khác.' : 'Hold and drag the bubble to move it.'}</p>
                <div className="mt-4 flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => void ask(s)} className={`h-9 px-3 rounded-lg border border-white/[0.07] bg-white/[0.02] text-[12.5px] ${T.sub} hover:text-white hover:bg-white/[0.05] text-left`}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m) => m.role === 'user' ? (
              <div key={m.id} className="flex justify-end"><div className="max-w-[85%] [overflow-wrap:anywhere] px-3 py-1.5 rounded-2xl rounded-br-md bg-neon-500/10 border border-white/[0.08] text-[13px]">{m.text}</div></div>
            ) : (
              <div key={m.id} className="flex gap-2">
                <span className="mt-0.5"><Orb size={20} glow={false} thinking={!!m.streaming} /></span>
                <div className="flex-1 min-w-0 text-[13px] leading-relaxed">
                  {m.streaming && !m.text && <p className={`${T.sub} animate-pulse`}>{m.status ? `${vi ? 'Đang tra' : 'Checking'}: ${m.status}…` : (vi ? 'Đang suy nghĩ…' : 'Thinking…')}</p>}
                  {m.text && <AgentMarkdown text={m.text} />}
                  {m.needsReview && (
                    <button type="button" onClick={() => openFull(m.question)} className="mt-2 h-8 px-3 rounded-lg bg-neon-500 text-[#0b0b10] text-[12.5px] font-semibold hover:bg-neon-400">
                      {vi ? 'Mở trang Agent để xem và xác nhận' : 'Open Agent to review and confirm'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void ask(input) }} className="p-2.5 border-t border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-black/25 p-1">
              <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder={vi ? 'Hỏi Makoto…' : 'Ask Makoto…'} aria-label={vi ? 'Nhắn cho Makoto' : 'Message Makoto'} className="flex-1 min-w-0 bg-transparent px-2 py-1.5 text-[13.5px] outline-none placeholder:text-[#6f6d7a]" />
              {busy
                ? <button type="button" onClick={() => abortRef.current?.abort()} aria-label={vi ? 'Dừng' : 'Stop'} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg bg-white/[0.1] text-white hover:bg-white/[0.16]"><Square size={12} fill="currentColor" /></button>
                : <button disabled={!input.trim()} aria-label={vi ? 'Gửi' : 'Send'} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg bg-neon-500 text-[#0b0b10] hover:bg-neon-400 disabled:bg-white/[0.06] disabled:text-white/30"><ArrowUp size={15} /></button>}
            </div>
          </form>
        </div>
      )}

      {greeting && !open && (
        <button
          type="button"
          onClick={() => { setGreeting(false); setOpen(true) }}
          className="mk-bubble-in fixed z-[45] w-[220px] text-left px-3.5 py-2.5 rounded-2xl border border-white/[0.08] bg-[#17171d] shadow-2xl text-[13px]"
          style={{ top: Math.max(MARGIN, pos.y + SIZE / 2 - 32), ...(greetOnLeft ? { left: Math.max(MARGIN, pos.x - 230) } : { left: Math.min(pos.x + SIZE + 10, viewportW - 220 - MARGIN) }) }}
        >
          <span className="block font-semibold">{greetText}</span>
          <span className={`block mt-0.5 text-[12px] ${T.sub}`}>{vi ? 'Bấm vào mình để hỏi nhanh nhé.' : 'Tap me for a quick question.'}</span>
        </button>
      )}

      {!(open && mobile) && (
        <button
          ref={bubbleRef}
          type="button"
          aria-label={open ? (vi ? 'Đóng Makoto Agent' : 'Close Makoto Agent') : (vi ? 'Mở Makoto Agent (giữ để kéo)' : 'Open Makoto Agent (hold to drag)')}
          aria-expanded={open}
          title={vi ? 'Bấm để chat · Giữ chuột để kéo' : 'Click to chat · Hold to drag'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; setDragging(false) }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}
          className={`fixed z-[45] flex items-center justify-center rounded-full border border-neon-400/30 bg-[#18181e] shadow-[0_8px_30px_rgba(0,0,0,0.5)] select-none touch-none ${dragging ? 'cursor-grabbing scale-110' : 'cursor-grab hover:scale-105'} transition-transform`}
          style={{ left: pos.x, top: pos.y, width: SIZE, height: SIZE }}
        >
          {busy && <span className="mk-halo" aria-hidden />}
          <span className="pointer-events-none"><Orb size={40} glow={!dragging} thinking={busy} float={!busy && !dragging} /></span>
          {busy && !open && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-neon-400 animate-pulse border-2 border-white/[0.08]" />}
        </button>
      )}
    </>
  )
}

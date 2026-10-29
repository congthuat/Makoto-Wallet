import { useEffect, useRef, useState } from 'react'

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Smoothly counts a number to its new value and reports which way it moved,
 * so the caller can flash green/red. Counts up from 0 on the first real value.
 */
export function useAnimatedNumber(target: number, { duration = 900, enabled = true }: { duration?: number; enabled?: boolean } = {}) {
  const animate = enabled && !prefersReducedMotion()
  const [value, setValue] = useState(animate ? 0 : target)
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; key: number } | null>(null)
  const from = useRef(animate ? 0 : target)
  const frame = useRef(0)

  useEffect(() => {
    if (!Number.isFinite(target)) return
    cancelAnimationFrame(frame.current)
    if (!enabled || prefersReducedMotion()) { from.current = target; setValue(target); return }
    const start = from.current
    if (Math.abs(target - start) < 1e-9) { setValue(target); return }
    // Flash only on real changes, not on the first count-up from zero.
    if (start !== 0) setFlash({ dir: target > start ? 'up' : 'down', key: Date.now() })
    const t0 = performance.now()
    const dur = start === 0 ? duration * 1.3 : duration
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur)
      const v = start + (target - start) * (1 - Math.pow(1 - p, 4))
      from.current = p < 1 ? v : target
      setValue(p < 1 ? v : target)
      if (p < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [target, enabled, duration])

  return { value, flash }
}

/** Gives each card on a fresh page an index so they rise one after another. */
export function staggerCards(root: HTMLElement | null) {
  if (!root || typeof MutationObserver === 'undefined') return () => {}
  let i = 0
  const tag = () => {
    root.querySelectorAll<HTMLElement>('.mk-card, .mk-hero').forEach((el) => {
      if (el.dataset.mkI) return
      el.dataset.mkI = String(i)
      el.style.setProperty('--mk-i', String(Math.min(i, 7)))
      i += 1
    })
  }
  tag()
  const observer = new MutationObserver(tag)
  observer.observe(root, { childList: true, subtree: true })
  // Only the first moments of a page cascade; later cards just appear.
  const stop = window.setTimeout(() => observer.disconnect(), 1500)
  return () => { observer.disconnect(); window.clearTimeout(stop) }
}

/** Cursor spotlight on cards (desktop pointer only). */
export function installCardSpotlight() {
  if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return () => {}
  let active: HTMLElement | null = null
  const onMove = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest?.('.mk-card') as HTMLElement | null
    if (active && active !== card) { delete active.dataset.spot; active = null }
    if (!card) return
    const r = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${event.clientX - r.left}px`)
    card.style.setProperty('--my', `${event.clientY - r.top}px`)
    if (active !== card) { card.dataset.spot = ''; active = card }
  }
  const onLeave = () => { if (active) { delete active.dataset.spot; active = null } }
  document.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  return () => { document.removeEventListener('pointermove', onMove); document.documentElement.removeEventListener('pointerleave', onLeave) }
}

/** Run a DOM update as a circular reveal from (x, y) where the browser supports it. */
export function circularReveal(update: () => void, x?: number, y?: number) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (!doc.startViewTransition || prefersReducedMotion() || x == null || y == null) { update(); return }
  const root = document.documentElement
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  root.style.setProperty('--mk-vt-x', `${x}px`)
  root.style.setProperty('--mk-vt-y', `${y}px`)
  root.style.setProperty('--mk-vt-r', `${r}px`)
  doc.startViewTransition(update)
}

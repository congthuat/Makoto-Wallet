import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'mk.theme'
const listeners = new Set<() => void>()
let current: Theme = (() => {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch { return 'dark' }
})()

function apply(t: Theme) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset.theme = t
  el.classList.toggle('dark', t === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f6f6f8' : '#0b0b10')
}
apply(current)

export function setTheme(t: Theme) {
  current = t
  try { localStorage.setItem(KEY, t) } catch { /* ignore */ }
  apply(t)
  listeners.forEach((f) => f())
}

export function useTheme() {
  const theme = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => current, () => 'dark' as Theme)
  return [theme, setTheme] as const
}

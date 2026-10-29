import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Remembers a successful copy for ~1.6s so the icon can turn into a check. */
export function useCopied(ms = 1600) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const run = async (copy: () => Promise<boolean> | boolean | void) => {
    const ok = await copy()
    if (ok === false) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), ms)
  }
  return [copied, run] as const
}

/** Copy icon that briefly becomes a green check after copying. */
export function CopyGlyph({ copied, size = 14, className = '' }: { copied: boolean; size?: number; className?: string }) {
  return copied
    ? <Check key="done" size={size} strokeWidth={2.6} className={`mk-copied text-live ${className}`} aria-hidden />
    : <Copy key="copy" size={size} className={className} aria-hidden />
}

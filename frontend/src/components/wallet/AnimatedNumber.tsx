import { useAnimatedNumber } from '../../lib/motion'
import { usd } from '../../lib/wallet'

/**
 * A dollar amount that counts to its new value and briefly flashes
 * green (up) or red (down). Hidden balances never animate.
 */
export function AnimatedUsd({ value, mask = (v) => v, hidden = false, digits = 2, split = false, className = '' }: {
  value: number
  mask?: (value: string) => string
  hidden?: boolean
  digits?: number
  /** Render cents in a muted colour, like the portfolio header. */
  split?: boolean
  className?: string
}) {
  const { value: shown, flash } = useAnimatedNumber(value, { enabled: !hidden })
  const masked = mask(usd(hidden ? value : shown, digits))
  const flashClass = flash ? (flash.dir === 'up' ? 'mk-flash-up' : 'mk-flash-down') : ''
  const [whole, cents] = masked.split('.')
  return (
    <span key={flash?.key} className={`${flashClass} ${className}`}>
      <span className="sr-only">{mask(usd(value, digits))}</span>
      <span aria-hidden>{split && cents != null ? <>{whole}<span className="text-[#83838E]">.{cents}</span></> : masked}</span>
    </span>
  )
}

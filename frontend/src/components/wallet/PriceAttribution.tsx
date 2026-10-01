import { useT } from '../../lib/i18n'
import { T } from './ui'

export function PriceAttribution({ className = '' }: { className?: string }) {
  const [tr] = useT()
  return (
    <div className={`text-right text-[11px] leading-4 ${T.mute} ${className}`}>
      <a href="https://www.coingecko.com/en/api" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--fg-base)] transition-colors">
        {tr('Price data by CoinGecko')}
      </a>
    </div>
  )
}

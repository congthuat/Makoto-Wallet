import type { ReactNode } from 'react'
import { FEEDBACK_FORM_URL } from '../../lib/feedback'
import { useT } from '../../lib/i18n'

export function FeedbackLink({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const [tr] = useT()
  const label = tr('Open feedback form (opens in a new tab)')
  return (
    <a href={FEEDBACK_FORM_URL} target="_blank" rel="noopener noreferrer" onClick={onClick}
      aria-label={label} title={label}
      className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-400/70 ${className}`}>
      {children}
    </a>
  )
}

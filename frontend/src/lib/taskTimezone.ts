import { taskText, type TaskLanguage } from './taskText.ts'

export type TaskTimezoneDate = Date | number | string
export type TaskTimezonePresentation = Readonly<{ label: string; offset: string | null; isLocal: boolean; timezone: string }>

/** Presentation only. Task binding and stored IANA values remain authoritative. */
export function browserTimezone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined }
  catch { return undefined }
}

function canonicalTimezone(timezone: string | undefined): string | undefined {
  if (!timezone) return undefined
  try { return new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone }
  catch { return undefined }
}

/** Intl uses the named zone's rules at this date, including DST and minute offsets. */
export function formatTimezoneOffset(timezone: string, relevantDate: TaskTimezoneDate = Date.now()): string | null {
  const date = relevantDate instanceof Date ? new Date(relevantDate.getTime()) : new Date(relevantDate)
  if (!Number.isFinite(date.getTime()) || !timezone) return null
  try {
    const value = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value
    const match = value?.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/)
    if (!match) return null
    const hours = Number(match[2] ?? 0)
    const minutes = Number(match[3] ?? 0)
    const seconds = Number(match[4] ?? 0)
    if (!hours && !minutes && !seconds) return 'UTC+0'
    return `UTC${match[1]}${hours}${minutes || seconds ? `:${String(minutes).padStart(2, '0')}` : ''}${seconds ? `:${String(seconds).padStart(2, '0')}` : ''}`
  } catch { return null }
}

export function formatTaskTimezone(timezone: string, locale: TaskLanguage, relevantDate: TaskTimezoneDate = Date.now(), localTimezone: string | undefined = browserTimezone()): TaskTimezonePresentation {
  const canonical = canonicalTimezone(timezone)
  const offset = canonical ? formatTimezoneOffset(timezone, relevantDate) : null
  // Equal offsets do not establish equal timezones. Resolve aliases through Intl.
  const isLocal = !!offset && !!canonical && canonical === canonicalTimezone(localTimezone)
  const label = offset ? `${offset} · ${isLocal ? taskText('localTime', locale) : timezone}` : `${taskText(canonical ? 'offsetUnavailable' : 'timezoneUnavailable', locale)}${timezone ? ` · ${timezone}` : ''}`
  return Object.freeze({ label, offset, isLocal, timezone })
}

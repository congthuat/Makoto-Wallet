export type CurrentDateTime = Readonly<{
  iso: string
  localDate: string
  localTime: string
  timezone: string
  offset: string
}>

function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
  catch { return 'UTC' }
}

function partsFor(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value
    return result
  }, {})
}

function offsetFor(date: Date, timezone: string) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(date).find((item) => item.type === 'timeZoneName')?.value
    return part && part !== 'GMT' ? part.replace(/^GMT/, 'UTC') : 'UTC'
  } catch { return 'UTC' }
}

/** Deterministic browser-side read. No network or model knowledge is used. */
export function getCurrentDateTime(now = new Date(), timezone = browserTimeZone()): CurrentDateTime {
  const parts = partsFor(now, timezone)
  return Object.freeze({
    iso: now.toISOString(),
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    timezone,
    offset: offsetFor(now, timezone),
  })
}

export function formatCurrentDateTime(value: CurrentDateTime, locale: 'en' | 'vi') {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: value.timezone }).format(new Date(value.iso))
}

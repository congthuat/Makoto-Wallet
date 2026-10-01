import type { SendRecord } from './sendExecution.ts'
import type { Tx } from './wallet.ts'

export function sendActivityStatus(status: SendRecord['status']): NonNullable<Tx['status']> {
  return status
}

/** A temporary provider failure must never erase a proven receipt outcome. */
export function mergeSendRecord(old: SendRecord | undefined, next: SendRecord): SendRecord {
  if (old && (old.status === 'completed' || old.status === 'failed')) return old
  return next
}

export function activityDate(timestamp: number, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : lang === 'en' ? 'en-US' : lang, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(timestamp)
}

export function activityDay(timestamp: number, lang: string, now = Date.now()): string {
  const date = new Date(timestamp)
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : lang === 'en' ? 'en-US' : lang, {
    dateStyle: 'medium',
  }).format(timestamp)
}

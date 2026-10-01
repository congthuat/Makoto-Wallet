import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browserTimezone, formatTaskTimezone, formatTimezoneOffset } from './taskTimezone.ts'
import { taskBinding } from './tasks.ts'

const winter = '2026-01-15T12:00:00.000Z'
const summer = '2026-07-15T12:00:00.000Z'

test('Asia/Bangkok displays UTC+7 at both relevant dates', () => {
  assert.equal(formatTimezoneOffset('Asia/Bangkok', winter), 'UTC+7')
  assert.equal(formatTimezoneOffset('Asia/Bangkok', summer), 'UTC+7')
})

test('Asia/Tokyo displays UTC+9', () => {
  assert.equal(formatTimezoneOffset('Asia/Tokyo', summer), 'UTC+9')
})

test('America/New_York follows the relevant date including the DST transition', () => {
  assert.equal(formatTimezoneOffset('America/New_York', winter), 'UTC-5')
  assert.equal(formatTimezoneOffset('America/New_York', summer), 'UTC-4')
  assert.equal(formatTimezoneOffset('America/New_York', '2026-03-08T06:59:00.000Z'), 'UTC-5')
  assert.equal(formatTimezoneOffset('America/New_York', '2026-03-08T07:00:00.000Z'), 'UTC-4')
})

test('formatting preserves the authoritative stored IANA value and task binding', () => {
  const saved = Object.freeze({ timezone: 'America/New_York', nextRunAt: summer, schedule: Object.freeze({ kind: 'DAILY', time: '08:00' }) })
  const before = JSON.stringify(saved)
  const display = formatTaskTimezone(saved.timezone, 'en', saved.nextRunAt, 'Asia/Bangkok')
  assert.equal(display.timezone, 'America/New_York')
  assert.equal(JSON.stringify(saved), before)
  assert.deepEqual(taskBinding({ mode: 'watch', address: '0x1111111111111111111111111111111111111111', timezone: saved.timezone }), {
    ok: true, account: '0x1111111111111111111111111111111111111111', chainId: 5042002, timezone: 'America/New_York',
  })
})

test('VI local timezone presentation uses the current locale', () => {
  assert.deepEqual(formatTaskTimezone('Asia/Bangkok', 'vi', summer, 'Asia/Bangkok'), {
    label: 'UTC+7 · Giờ địa phương', offset: 'UTC+7', isLocal: true, timezone: 'Asia/Bangkok',
  })
})

test('EN local timezone presentation uses the current locale', () => {
  assert.deepEqual(formatTaskTimezone('Asia/Bangkok', 'en', summer, 'Asia/Bangkok'), {
    label: 'UTC+7 · Local time', offset: 'UTC+7', isLocal: true, timezone: 'Asia/Bangkok',
  })
})

test('Europe/London observes winter UTC+0 and summer UTC+1', () => {
  assert.equal(formatTimezoneOffset('Europe/London', winter), 'UTC+0')
  assert.equal(formatTimezoneOffset('Europe/London', summer), 'UTC+1')
})

test('fractional offsets retain their minute precision', () => {
  assert.equal(formatTimezoneOffset('Asia/Kolkata', summer), 'UTC+5:30')
  assert.equal(formatTimezoneOffset('Asia/Kathmandu', summer), 'UTC+5:45')
  assert.equal(formatTimezoneOffset('America/St_Johns', winter), 'UTC-3:30')
})

test('a saved nonlocal zone shows its IANA name rather than Local time', () => {
  assert.equal(formatTaskTimezone('Asia/Tokyo', 'en', summer, 'Asia/Bangkok').label, 'UTC+9 · Asia/Tokyo')
  assert.equal(formatTaskTimezone('America/New_York', 'vi', winter, 'Asia/Bangkok').label, 'UTC-5 · America/New_York')
})

test('matching offsets alone do not establish the browser timezone', () => {
  const result = formatTaskTimezone('Asia/Ho_Chi_Minh', 'vi', summer, 'Asia/Bangkok')
  assert.equal(result.offset, 'UTC+7')
  assert.equal(result.isLocal, false)
  assert.equal(result.label, 'UTC+7 · Asia/Ho_Chi_Minh')
})

test('Intl aliases can identify the same local zone without rewriting the saved alias', () => {
  const result = formatTaskTimezone('US/Eastern', 'en', summer, 'America/New_York')
  assert.equal(result.label, 'UTC-4 · Local time')
  assert.equal(result.timezone, 'US/Eastern')
})

test('an invalid saved timezone stays unavailable and is never called local', () => {
  assert.equal(formatTimezoneOffset('Invalid/Zone', summer), null)
  assert.deepEqual(formatTaskTimezone('Invalid/Zone', 'en', summer, 'Invalid/Zone'), {
    label: 'Timezone unavailable · Invalid/Zone', offset: null, isLocal: false, timezone: 'Invalid/Zone',
  })
  assert.equal(formatTaskTimezone('Invalid/Zone', 'vi', summer, 'Asia/Bangkok').label, 'Múi giờ chưa khả dụng · Invalid/Zone')
})

test('an invalid relevant date does not fabricate a current offset', () => {
  assert.equal(formatTimezoneOffset('Asia/Bangkok', 'not-a-date'), null)
  assert.equal(formatTimezoneOffset('Asia/Bangkok', new Date(Number.NaN)), null)
  assert.equal(formatTaskTimezone('Asia/Bangkok', 'en', 'not-a-date', 'Asia/Bangkok').label, 'UTC offset unavailable · Asia/Bangkok')
})

test('unknown browser zone preserves the valid saved zone and avoids Local time', () => {
  assert.equal(formatTaskTimezone('Asia/Bangkok', 'en', summer, '').label, 'UTC+7 · Asia/Bangkok')
  assert.equal(formatTaskTimezone('', 'vi', summer, 'Asia/Bangkok').label, 'Múi giờ chưa khả dụng')
})

test('browser timezone detection agrees with the existing Intl binding source', () => {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
  assert.equal(browserTimezone(), detected)
  const binding = taskBinding({ mode: 'watch', address: '0x1111111111111111111111111111111111111111' })
  assert.ok(binding.ok)
  assert.equal(binding.timezone, detected)
})

test('Date and timestamp inputs agree without changing the supplied Date', () => {
  const date = new Date(summer)
  const milliseconds = date.getTime()
  assert.equal(formatTimezoneOffset('America/New_York', date), 'UTC-4')
  assert.equal(formatTimezoneOffset('America/New_York', milliseconds), 'UTC-4')
  assert.equal(date.getTime(), milliseconds)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { formatCurrentDateTime, getCurrentDateTime } from './time.ts'

test('current time tool returns browser-local date, time, timezone, and offset', () => {
  const value = getCurrentDateTime(new Date('2026-09-29T04:05:06.000Z'), 'Asia/Bangkok')
  assert.deepEqual(value, {
    iso: '2026-09-29T04:05:06.000Z',
    localDate: '2026-09-29',
    localTime: '11:05:06',
    timezone: 'Asia/Bangkok',
    offset: 'UTC+07:00',
  })
  assert.match(formatCurrentDateTime(value, 'en'), /Sep|2026/)
  assert.match(formatCurrentDateTime(value, 'vi'), /2026/)
})

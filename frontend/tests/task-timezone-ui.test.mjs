import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// Production rendering with read-only context fixtures. No auth, provider,
// scheduler, persistence, or onCreate handler executes during SSR.
const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureKey = '__makotoTaskTimezoneUiFixture'
const previousFixture = globalThis[fixtureKey]
const previousTimezone = process.env.TZ
const account = '0x1111111111111111111111111111111111111111'
let server, TaskReviewCard, TasksPage

before(async () => {
  process.env.TZ = 'Asia/Bangkok'
  server = await createServer({
    root: frontendRoot, configFile: false, appType: 'custom',
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
    plugins: [{
      name: 'task-timezone-context-fixtures', enforce: 'pre',
      resolveId(source) {
        if (source.endsWith('/lib/store')) return '\0timezone-ui-wallet'
        if (source.endsWith('/lib/i18n')) return '\0timezone-ui-language'
      },
      load(id) {
        if (id === '\0timezone-ui-wallet') return `export const useWallet = () => globalThis.${fixtureKey}.wallet;`
        if (id === '\0timezone-ui-language') return `
          export * from '/src/lib/i18n.ts';
          import { translate } from '/src/lib/i18n.ts';
          export const useT = () => {
            const language = globalThis.${fixtureKey}.language;
            return [(value) => typeof value === 'string' ? translate(value, language) : value, language];
          };
        `
      },
    }],
  })
  TaskReviewCard = (await server.ssrLoadModule('/src/components/TaskReviewCard.tsx')).TaskReviewCard
  TasksPage = (await server.ssrLoadModule('/src/pages/Tasks.tsx')).default
})

after(async () => {
  await server?.close()
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
  if (previousFixture === undefined) delete globalThis[fixtureKey]
  else globalThis[fixtureKey] = previousFixture
})

function candidate(timezone = 'Asia/Bangkok') {
  return {
    type: 'SCHEDULED_AUTOMATION', title: 'Daily portfolio summary', description: '', account,
    chainId: 5042002, timezone, sourceIntent: 'Summarize my portfolio every day at 08:00',
    locale: 'en', condition: null, schedule: { kind: 'DAILY', time: '08:00', action: 'PORTFOLIO_SUMMARY' },
    authority: 'READ_ONLY', createdBy: 'USER',
  }
}

function savedTask(timezone, nextRunAt, id) {
  return {
    ...candidate(timezone), id, status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    nextRunAt, lastRunAt: null, lastResult: null, lastError: null, triggerCount: 0, previousConditionState: null,
  }
}

function render(Component, language, props = {}, tasks = []) {
  globalThis[fixtureKey] = {
    language,
    wallet: { mode: 'connected', address: account, walletChainId: 5042002, taskAuthenticated: true,
      tasks, tasksLoading: false, tasksError: false, taskNotifications: [], taskNotificationsError: false },
  }
  return renderToStaticMarkup(createElement(Component, props))
}

function visibleText(html) { return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
const forbidCreate = async () => { throw new Error('SSR must never create a task') }

for (const [language, friendly, schedule] of [
  ['vi', 'UTC+7 · Giờ địa phương', 'Hằng ngày 08:00 giờ địa phương'],
  ['en', 'UTC+7 · Local time', 'Daily 08:00 local time'],
]) {
  test(`${language} production task review renders friendly local timezone and schedule while retaining IANA`, () => {
    const value = candidate()
    const before = JSON.stringify(value)
    const html = render(TaskReviewCard, language, { candidate: value, tasks: [], onCreate: forbidCreate })
    assert.ok(visibleText(html).includes(friendly))
    assert.ok(visibleText(html).includes(schedule))
    assert.match(html, /title="Asia\/Bangkok" data-task-timezone="Asia\/Bangkok"/)
    assert.equal(JSON.stringify(value), before)
  })
}

test('production review never describes another saved timezone as local', () => {
  const html = render(TaskReviewCard, 'en', { candidate: candidate('Asia/Tokyo'), tasks: [], onCreate: forbidCreate })
  assert.ok(visibleText(html).includes('UTC+9 · Asia/Tokyo'))
  assert.ok(visibleText(html).includes('Daily 08:00'))
  assert.doesNotMatch(visibleText(html), /Local time|local time/)
})

test('saved task cards use each nextRunAt for New York DST without rewriting stored tasks', () => {
  const tasks = [savedTask('America/New_York', '2026-01-15T13:00:00.000Z', 'winter'), savedTask('America/New_York', '2026-07-15T12:00:00.000Z', 'summer')]
  const before = JSON.stringify(tasks)
  for (const language of ['vi', 'en']) {
    const html = render(TasksPage, language, {}, tasks)
    const text = visibleText(html)
    assert.ok(text.includes('UTC-5 · America/New_York'))
    assert.ok(text.includes('UTC-4 · America/New_York'))
    assert.equal([...html.matchAll(/data-task-timezone="America\/New_York"/g)].length, 2)
    assert.doesNotMatch(text, /Local time|local time|Giờ địa phương|giờ địa phương/)
  }
  assert.equal(JSON.stringify(tasks), before)
})

test('existing local task card has a friendly label with its original IANA available as detail', () => {
  const task = savedTask('Asia/Bangkok', '2026-10-02T01:00:00.000Z', 'local')
  const html = render(TasksPage, 'vi', {}, [task])
  assert.ok(visibleText(html).includes('UTC+7 · Giờ địa phương'))
  assert.match(html, /title="Asia\/Bangkok" data-task-timezone="Asia\/Bangkok"/)
  assert.equal(task.timezone, 'Asia/Bangkok')
})

test('invalid stored zone review renders an honest unavailable label', () => {
  const html = render(TaskReviewCard, 'vi', { candidate: candidate('Invalid/Zone'), tasks: [], onCreate: forbidCreate })
  assert.ok(visibleText(html).includes('Múi giờ chưa khả dụng · Invalid/Zone'))
  assert.match(html, /data-task-timezone="Invalid\/Zone"/)
  assert.doesNotMatch(visibleText(html), /UTC\+7|Giờ địa phương|giờ địa phương/)
})

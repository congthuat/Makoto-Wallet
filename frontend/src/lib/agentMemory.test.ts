import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_MEMORY_KEY, MAX_AGENT_NOTES, addNote, contactInText, contactSaveCheck, loadAgentMemory, memoryForRequest, removeNote, resolveContact, saveAgentMemory, setBridgeSpeed } from './agentMemory.ts'
import { describeStep, parsePlan, parsePlanStep, planStatuses, planStepsFromText, stepCommand } from './agentPlan.ts'

const NAM = '0x1111111111111111111111111111111111111111'
const LAN = '0x2222222222222222222222222222222222222222'
const contacts = [{ name: 'Nam', address: NAM }, { name: 'Lan Anh', address: LAN }]
const store = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, data } }

test('notes are saved on the device, deduplicated, capped, and secrets/addresses are refused', () => {
  let memory = loadAgentMemory(undefined)
  memory = addNote(memory, 'Mình thích câu trả lời ngắn gọn', 1, 'a').memory
  memory = addNote(memory, '  mình THÍCH câu trả lời ngắn gọn ', 2, 'b').memory
  assert.equal(memory.notes.length, 1)
  for (const secret of [`gửi về ${NAM}`, 'my seed phrase is apple banana', 'private key abc']) assert.equal(addNote(memory, secret).note, undefined)
  for (let i = 0; i < 15; i++) memory = addNote(memory, `note ${i}`, 10 + i, `n${i}`).memory
  assert.equal(memory.notes.length, MAX_AGENT_NOTES)
  assert.equal(memory.notes.at(-1)?.text, 'note 14')
  memory = removeNote(setBridgeSpeed(memory, 'SLOW'), 'n14')
  const s = store()
  assert.equal(saveAgentMemory(s, memory), true)
  const loaded = loadAgentMemory(s)
  assert.equal(loaded.notes.length, MAX_AGENT_NOTES - 1)
  assert.equal(loaded.preferences.bridgeSpeed, 'SLOW')
  s.data.set(AGENT_MEMORY_KEY, '{broken')
  assert.deepEqual(loadAgentMemory(s).notes, [])
})

test('only contact names and notes are sent to the Agent, never addresses', () => {
  const memory = setBridgeSpeed(addNote(loadAgentMemory(undefined), 'prefer EURC', 1, 'x').memory, 'FAST')
  const payload = memoryForRequest(memory, contacts)
  assert.deepEqual(payload, { notes: ['prefer EURC'], contacts: ['Nam', 'Lan Anh'], preferences: { bridgeSpeed: 'FAST' } })
  assert.doesNotMatch(JSON.stringify(payload), /0x[0-9a-f]{40}/i)
  assert.equal(memoryForRequest(loadAgentMemory(undefined), []), undefined)
})

test('contacts resolve locally by exact name; missing or ambiguous names never resolve', () => {
  assert.equal(resolveContact('  lan   anh ', contacts).ok && (resolveContact('lan anh', contacts) as { contact: { address: string } }).contact.address, LAN)
  assert.deepEqual(resolveContact('Lan', contacts), { ok: false, reason: 'not-found' })
  assert.deepEqual(resolveContact('Nam', [...contacts, { name: 'nam', address: LAN }]), { ok: false, reason: 'ambiguous' })
  assert.equal(contactSaveCheck('Minh', '0x3333333333333333333333333333333333333333', contacts), 'ok')
  assert.equal(contactSaveCheck('Minh', NAM, contacts), 'duplicate-address')
  assert.equal(contactSaveCheck('nam', '0x3333333333333333333333333333333333333333', contacts), 'duplicate-name')
  assert.equal(contactSaveCheck('', NAM, contacts), 'invalid')
  assert.equal(contactSaveCheck('X', '0x12', contacts), 'invalid')
})

test('plan steps are shape-checked and rebuilt as canonical commands with local contact resolution', () => {
  assert.equal(parsePlanStep({ kind: 'send', asset: 'USDC', amount: 'MAX', recipientContact: 'Nam' }), undefined)
  assert.equal(parsePlanStep({ kind: 'swap', asset: 'cirBTC', amount: '1', outputAsset: 'USDC' }), undefined)
  assert.equal(parsePlanStep({ kind: 'bridge', asset: 'EURC', amount: '1' }), undefined)
  assert.equal(parsePlan([{ kind: 'bridge', asset: 'USDC', amount: '1' }]), undefined, 'a plan needs at least 2 steps')
  const plan = parsePlan([{ kind: 'swap', asset: 'USDC', amount: '10', outputAsset: 'EURC' }, { kind: 'send', asset: 'EURC', amount: '5', recipientContact: 'Nam' }])
  assert.ok(plan)
  assert.deepEqual(stepCommand(plan[0], contacts), { ok: true, command: 'swap 10 USDC to EURC' })
  assert.deepEqual(stepCommand(plan[1], contacts), { ok: true, command: `send 5 EURC to ${NAM}`, contactName: 'Nam' })
  assert.deepEqual(stepCommand({ kind: 'send', asset: 'USDC', amount: '1', recipientContact: 'Ghost' }, contacts), { ok: false, reason: 'contact-not-found', name: 'Ghost' })
  assert.equal(describeStep(plan[1], true), 'Gửi 5 EURC cho Nam')
})

test('deterministic "then / rồi" requests become plans; incomplete or MAX parts do not', () => {
  const steps = planStepsFromText(`swap 10 USDC to EURC then send 5 EURC to ${LAN}`, 'en')
  assert.deepEqual(steps, [{ kind: 'swap', asset: 'USDC', amount: '10', outputAsset: 'EURC' }, { kind: 'send', asset: 'EURC', amount: '5', recipient: LAN }])
  assert.equal(planStepsFromText('swap 10 USDC to EURC rồi gửi hết EURC', 'vi'), undefined)
  assert.equal(planStepsFromText('swap 10 USDC to EURC', 'en'), undefined)
})

test('plan steps unlock strictly in order, one at a time', () => {
  assert.deepEqual(planStatuses([false, false, false], undefined, undefined), ['ready', 'waiting', 'waiting'])
  assert.deepEqual(planStatuses([false, false], 0, undefined), ['active', 'waiting'])
  assert.deepEqual(planStatuses([true, false], undefined, undefined), ['done', 'ready'])
  assert.deepEqual(planStatuses([true, false], undefined, 1), ['done', 'failed'])
  assert.deepEqual(planStatuses([true, true], undefined, undefined), ['done', 'done'])
})

test('a saved contact named after a recipient word is found deterministically', () => {
  const book = [...contacts, { name: 'Lan', address: '0x3333333333333333333333333333333333333333' }]
  assert.equal(contactInText('Gửi 2 USDC cho Nam nhé', book)?.address, NAM)
  assert.equal(contactInText('send 2 usdc to lan anh', book)?.address, LAN)
  assert.equal(contactInText('gửi 1 EURC tới Lan.', book)?.name, 'Lan')
  assert.equal(contactInText('gửi 1 USDC cho Namxyz', book), undefined)
  assert.equal(contactInText('Nam gửi 1 USDC', book), undefined)
  assert.equal(contactInText('gửi 1 USDC cho Nam', [...book, { name: 'nam', address: LAN }]), undefined, 'ambiguous names never resolve')
})

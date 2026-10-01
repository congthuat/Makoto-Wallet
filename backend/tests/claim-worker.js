const { TaskEngine } = require('../lib/taskEngine')

let engine
let now
let releaseRead
let iteration = 0

const reply = (message) => process.send?.(message)
const awaitRelease = () => new Promise((resolve) => { releaseRead = resolve })

process.on('message', async (message) => {
  try {
    if (message.type === 'INIT') {
      now = message.now
      const reads = {
        verifyChain: async () => {},
        readBalance: async () => {
          reply({ type: 'READ_STARTED', iteration })
          await awaitRelease()
          return { amount: '100', units: '100000000', source: 'fixture', observedAt: new Date(now).toISOString() }
        },
        readBalances: async () => {
          reply({ type: 'READ_STARTED', iteration })
          await awaitRelease()
          return { balances: { USDC: { amount: '100' } }, unavailable: [], observedAt: new Date(now).toISOString() }
        },
      }
      engine = new TaskEngine({ dbPath: message.dbPath, now: () => now, leaseMs: message.leaseMs ?? 120_000, reads, generateSummary: async () => ({ ok: false }) })
      reply({ type: 'READY' })
    } else if (message.type === 'SET_NOW') {
      now = message.now
      reply({ type: 'NOW_SET' })
    } else if (message.type === 'RECOVER') {
      engine.recover()
      reply({ type: 'RECOVERED' })
    } else if (message.type === 'GO') {
      iteration = message.iteration
      await engine.tick()
      reply({ type: 'DONE', iteration })
    } else if (message.type === 'RELEASE') {
      releaseRead?.()
      releaseRead = null
    } else if (message.type === 'CLOSE') {
      await engine.close()
      reply({ type: 'CLOSED' })
      process.exit(0)
    }
  } catch (error) {
    reply({ type: 'ERROR', iteration, code: error?.code || 'WORKER_ERROR' })
  }
})

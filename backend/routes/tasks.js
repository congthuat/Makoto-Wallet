const { Router } = require('express')
const { parseIntent, TaskError } = require('../lib/taskDefinitions')
const { getTaskEngine } = require('../lib/taskEngine')
const { taskSession, requireTaskAuth, mutationOrigin, taskMutationRateLimit } = require('../lib/taskAuth')

function sendError(res, error) {
  if (error instanceof TaskError) return res.status(error.status).json({ code: error.code, error: error.message })
  console.error('tasks', error?.code || error?.name || 'unknown')
  return res.status(500).json({ code: 'TASK_EXECUTION_FAILED', error: 'Task service failed' })
}

function boundBody(req) {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('TASK_INVALID', 'Invalid task request', 400)
  const owner = req.session.address
  for (const key of ['account', 'ownerAddress', 'walletAddress']) {
    if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].toLowerCase() !== owner)) {
      throw new TaskError('TASK_FORBIDDEN', 'Task account does not match authenticated wallet', 403)
    }
  }
  return { ...body, account: owner }
}

function createTaskRouter(engine = getTaskEngine(), security = { taskSession, requireTaskAuth, mutationOrigin, taskMutationRateLimit }) {
  const router = Router()
  router.use(security.taskSession, security.requireTaskAuth, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  const mutationGuards = [security.mutationOrigin, security.taskMutationRateLimit]
  router.get('/', (req, res) => { try { res.json({ tasks: engine.listForOwner(req.session.address) }) } catch (error) { sendError(res, error) } })
  router.post('/parse', ...mutationGuards, (req, res) => { try { res.json(parseIntent(boundBody(req))) } catch (error) { sendError(res, error) } })
  router.get('/notifications', (req, res) => { try { res.json({ notifications: engine.notificationsForOwner(req.session.address) }) } catch (error) { sendError(res, error) } })
  router.post('/', ...mutationGuards, (req, res) => { try { res.status(201).json({ task: engine.createForOwner(req.session.address, boundBody(req)) }) } catch (error) { sendError(res, error) } })
  router.get('/:id', (req, res) => { try { res.json({ task: engine.getForOwner(req.session.address, req.params.id) }) } catch (error) { sendError(res, error) } })
  router.get('/:id/runs', (req, res) => { try { res.json({ runs: engine.listRunsForOwner(req.session.address, req.params.id) }) } catch (error) { sendError(res, error) } })
  router.patch('/:id', ...mutationGuards, (req, res) => { try { res.json({ task: engine.updateForOwner(req.session.address, req.params.id, req.body) }) } catch (error) { sendError(res, error) } })
  router.delete('/:id', ...mutationGuards, (req, res) => { try { engine.deleteForOwner(req.session.address, req.params.id); res.status(204).end() } catch (error) { sendError(res, error) } })
  router.post('/:id/run', ...mutationGuards, async (req, res) => {
    try {
      const outcome = await engine.runForOwner(req.session.address, req.params.id, 'MANUAL')
      if (outcome.run.status === 'FAILED') return res.status(502).json({ ...outcome, code: outcome.run.errorCode, error: 'Task read failed' })
      res.json(outcome)
    } catch (error) { sendError(res, error) }
  })
  return router
}

let defaultRouter
function taskRoute(req, res, next) {
  if (!defaultRouter) defaultRouter = createTaskRouter()
  return defaultRouter(req, res, next)
}

module.exports = taskRoute
module.exports.createTaskRouter = createTaskRouter

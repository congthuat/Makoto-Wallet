// GET /api/sentiment — Crypto Fear & Greed index (latest + 30d history)
const { fearGreed } = require('../lib/marketData')
const { Router } = require('express')
const router = Router()

let memo = null
router.get('/', async (_req, res) => {
  try {
    if (memo && Date.now() - memo.t < 10 * 60 * 1000) return res.json(memo.v)
    const r = await fearGreed(31)
    const rows = r.rows
    const latest = rows[0] ?? null
    const v = {
      value: latest?.value ?? null,
      label: latest?.classification ?? null,
      btcPrice: latest?.price ?? null,
      yesterday: rows[1]?.value ?? null,
      weekAgo: rows[7]?.value ?? null,
      monthAgo: rows[rows.length - 1]?.value ?? null,
      source: r.source,
      history: rows.map((x) => [x.timestamp * 1000, x.value]).reverse(),
    }
    memo = { t: Date.now(), v }
    res.json(v)
  } catch (e) {
    // Surface upstream 402 (quota) as 402 so the client can distinguish
    // billing-related unavailability from a network or server error.
    const status = /402|PAID_BALANCE_ZERO|insufficient credit/i.test(String(e.message || e)) ? 402 : 502
    res.status(status).json({ error: String(e.message || e), code: status === 402 ? 'QUOTA_EXCEEDED' : undefined })
  }
})
module.exports = router

// GET /api/sentiment — Crypto Fear & Greed index (latest + 30d history)
const { dataApi } = require('@surf-ai/sdk/server')
const { Router } = require('express')
const router = Router()

let memo = null
router.get('/', async (_req, res) => {
  try {
    if (memo && Date.now() - memo.t < 10 * 60 * 1000) return res.json(memo.v)
    const from = Math.floor(Date.now() / 1000) - 31 * 86400
    const r = await dataApi.market.fear_greed({ from: String(from) })
    const rows = (r?.data ?? []).filter((x) => typeof x?.value === 'number')
    const latest = rows[0] ?? null
    const v = {
      value: latest?.value ?? null,
      label: latest?.classification ?? null,
      btcPrice: latest?.price ?? null,
      yesterday: rows[1]?.value ?? null,
      weekAgo: rows[7]?.value ?? null,
      monthAgo: rows[rows.length - 1]?.value ?? null,
      history: rows.map((x) => [x.timestamp * 1000, x.value]).reverse(),
    }
    memo = { t: Date.now(), v }
    res.json(v)
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})
module.exports = router

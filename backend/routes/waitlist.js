const { Router } = require('express')
const { dbProvision, dbQuery } = require('@surf-ai/sdk/db')
const router = Router()

let ready = null
const ensure = () => (ready ??= dbProvision().then(() => dbQuery(
  `CREATE TABLE IF NOT EXISTS waitlist (id serial primary key, email text not null unique, lang text, created_at timestamptz default now())`, [],
)).catch((e) => { ready = null; throw e }))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

router.get('/', async (_req, res) => {
  try {
    await ensure()
    const r = await dbQuery('SELECT COUNT(*)::int AS n FROM waitlist', [])
    const row = r?.rows?.[0] ?? r?.[0]
    res.json({ count: Array.isArray(row) ? row[0] : row?.n ?? 0 })
  } catch (e) { res.status(503).json({ error: 'Waitlist unavailable' }) }
})

router.post('/', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const lang = String(req.body?.lang ?? 'en').slice(0, 5)
  if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: 'Invalid email' })
  try {
    await ensure()
    await dbQuery('INSERT INTO waitlist (email, lang) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [email, lang])
    res.json({ ok: true })
  } catch (e) { res.status(503).json({ error: 'Waitlist unavailable' }) }
})

module.exports = router

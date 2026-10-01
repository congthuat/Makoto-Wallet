const { Router } = require('express')
const path = require('path')
const fs = require('fs')
const router = Router()

const FILE = path.join(__dirname, '..', 'files', 'makoto-wallet.zip')

router.get('/', (_req, res) => {
  if (!fs.existsSync(FILE)) return res.status(404).json({ error: 'File not found' })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', 'attachment; filename="makoto-wallet.zip"')
  fs.createReadStream(FILE).pipe(res)
})

module.exports = router

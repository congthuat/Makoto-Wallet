// Adapted from the donor's Next.js /api/cctp-fees and /api/cctp-status routes.
// Both endpoints are read-only; an unavailable Circle response is never a zero fee or completed bridge.
const { Router } = require('express')
const router = Router()
const IRIS = 'https://iris-api-sandbox.circle.com'
const BASE_RPC = 'https://sepolia.base.org'
const BASE_CHAIN_ID = '0x14a34'
const BASE_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const hash = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)

router.get('/fees', async (_req, res) => {
  try {
    const response = await fetch(`${IRIS}/v2/burn/USDC/fees/26/6?forward=true`, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error('Circle fee request failed')
    const payload = await response.json()
    const row = Array.isArray(payload) ? payload.find((item) => Number(item.finalityThreshold) === 2000) : undefined
    const minimumFee = Number(row?.minimumFee)
    const forward = row?.forwardFee?.med ?? row?.forwardFee?.medium
    const forwardFeeMed = typeof forward === 'number' && Number.isSafeInteger(forward) && forward >= 0 ? String(forward) : typeof forward === 'string' && /^\d+$/.test(forward) ? forward : undefined
    if (!row || !Number.isFinite(minimumFee) || minimumFee < 0 || !forwardFeeMed) throw new Error('Circle fee response invalid')
    res.set('Cache-Control', 'no-store').json({ finalityThreshold: 2000, minimumFee, forwardFeeMed, quotedAt: Date.now() })
  } catch { res.status(502).set('Cache-Control', 'no-store').json({ error: 'CCTP fee unavailable' }) }
})

router.get('/status', async (req, res) => {
  if (!hash(req.query.txHash)) return res.status(400).json({ error: 'Invalid transaction hash' })
  try {
    const response = await fetch(`${IRIS}/v2/messages/26?transactionHash=${req.query.txHash}`, { signal: AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
    if (response.status === 404) return res.set('Cache-Control', 'no-store').json({ status: 'pending' })
    if (!response.ok) throw new Error('Circle status request failed')
    const payload = await response.json()
    const message = payload?.messages?.[0]
    if (!message) return res.set('Cache-Control', 'no-store').json({ status: 'pending' })
    const forwardTxHash = hash(message.forwardTxHash) ? message.forwardTxHash : undefined
    const attestationAvailable = typeof message.attestation === 'string' && /^0x[0-9a-f]+$/i.test(message.attestation)
    // A forward hash or SDK callback is not a destination receipt.
    res.set('Cache-Control', 'no-store').json({ status: 'source-message-observed', messageStatus: typeof message.status === 'string' ? message.status : 'unknown', attestationAvailable, forwardTxHash })
  } catch { res.status(502).set('Cache-Control', 'no-store').json({ status: 'unavailable' }) }
})

// Destination completion is backed by a successful Base receipt and a matching USDC Transfer.
router.get('/destination', async (req, res) => {
  const { txHash, recipient, minimumUnits } = req.query
  if (!hash(txHash) || typeof recipient !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(recipient) || typeof minimumUnits !== 'string' || !/^\d+$/.test(minimumUnits) || BigInt(minimumUnits) <= 0n) return res.status(400).json({ error: 'Invalid destination query' })
  try {
    const rpc = async (method, params) => {
      const response = await fetch(BASE_RPC, { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
      if (!response.ok) throw new Error('Base RPC failed')
      const payload = await response.json()
      if (payload.error) throw new Error('Base RPC rejected request')
      return payload.result
    }
    if (await rpc('eth_chainId', []) !== BASE_CHAIN_ID) throw new Error('Base RPC is on the wrong chain')
    const receipt = await rpc('eth_getTransactionReceipt', [txHash])
    if (!receipt) return res.set('Cache-Control', 'no-store').json({ status: 'pending' })
    if (receipt.transactionHash?.toLowerCase() !== txHash.toLowerCase() || !receipt.blockHash || !receipt.blockNumber) throw new Error('Invalid Base receipt')
    if (receipt.status !== '0x1') return res.set('Cache-Control', 'no-store').json({ status: receipt.status === '0x0' ? 'failed' : 'unknown' })
    const target = `0x${recipient.slice(2).toLowerCase().padStart(64, '0')}`
    const matched = (receipt.logs ?? []).some((log) => {
      try { return log.address?.toLowerCase() === BASE_USDC && log.topics?.[0]?.toLowerCase() === TRANSFER_TOPIC && log.topics?.[2]?.toLowerCase() === target && /^0x[0-9a-f]+$/i.test(log.data) && BigInt(log.data) >= BigInt(minimumUnits) } catch { return false }
    })
    return res.set('Cache-Control', 'no-store').json({ status: matched ? 'confirmed' : 'unknown', blockNumber: receipt.blockNumber })
  } catch { return res.status(502).set('Cache-Control', 'no-store').json({ status: 'unavailable' }) }
})

module.exports = router

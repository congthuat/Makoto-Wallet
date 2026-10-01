const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const router = require('../routes/cctp')

const txHash = `0x${'a'.repeat(64)}`
const account = `0x${'1'.repeat(40)}`
const topic = `0x${'0'.repeat(24)}${account.slice(2)}`

async function withServer(handler) {
  const app = express(); app.use('/api/cctp', router)
  const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)) })
  try { return await handler(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise((resolve) => server.close(resolve)) }
}

test('CCTP route rejects invalid destination query and unavailable fees stay unavailable', async () => {
  const previous = global.fetch
  try {
    global.fetch = async () => new Response('down', { status: 503 })
    await withServer(async (base) => {
      assert.equal((await previous(`${base}/api/cctp/destination?txHash=bad`)).status, 400)
      assert.equal((await previous(`${base}/api/cctp/fees`)).status, 502)
    })
  } finally { global.fetch = previous }
})

test('Circle message alone does not confirm destination; matching Base receipt and USDC Transfer do', async () => {
  const previous = global.fetch
  try {
    let matched = false
    global.fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('iris-api')) return Response.json({ messages: [{ status: 'complete', attestation: '0xab', forwardTxHash: txHash }] })
      const rpcRequest = JSON.parse(String(init?.body ?? '{}'))
      if (rpcRequest.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: 1, result: '0x14a34' })
      const logs = matched ? [{ address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', topic, topic], data: '0x64' }] : []
      return Response.json({ result: { transactionHash: txHash, blockHash: txHash, blockNumber: '0x1', status: '0x1', logs } })
    }
    await withServer(async (base) => {
      const status = await (await previous(`${base}/api/cctp/status?txHash=${txHash}`)).json()
      assert.equal(status.status, 'source-message-observed')
      const url = `${base}/api/cctp/destination?txHash=${txHash}&recipient=${account}&minimumUnits=100`
      assert.equal((await (await previous(url)).json()).status, 'unknown')
      matched = true
      assert.equal((await (await previous(url)).json()).status, 'confirmed')
    })
  } finally { global.fetch = previous }
})

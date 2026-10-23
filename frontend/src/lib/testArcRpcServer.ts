/**
 * Shared test helper: a local HTTP server that acts as a mock Arc RPC endpoint.
 *
 * Import in any test file that calls production functions which use arcRpc()
 * (any function calling eth_getCode, eth_call, eth_gasPrice, eth_estimateGas,
 * eth_blockNumber, eth_getBalance, eth_getTransactionReceipt, eth_getTransactionByHash
 * via rpcRead()).
 *
 * Usage:
 *   import { startMockArcRpc, stopMockArcRpc, setMockArcRpcHandler, resetMockArcRpcHandler } from './testArcRpcServer.ts'
 *
 *   before(async () => {
 *     await startMockArcRpc()
 *     _setRpcTimeoutMsForTest(10)   // manage timeout separately — server has no opinion
 *   })
 *   after(async () => {
 *     _setRpcTimeoutMsForTest(undefined)
 *     await stopMockArcRpc()
 *   })
 *
 * Handler notes:
 *   - setMockArcRpcHandler() can be called per-test to customise responses.
 *   - resetMockArcRpcHandler() restores the default (returns '0x1' for everything).
 *   - Handler may return a value or a Promise.  A hanging Promise simulates a
 *     stalled Arc RPC — the AbortController in arcRpc() will abort the fetch
 *     and the server silently drops the pending response.
 *   - The server is safe to share across sequential tests in the same file.
 *     Do NOT share a single server instance across parallel test files.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { _setArcRpcUrlForTest } from './arcRpc.ts'

type HandlerResult = unknown
type Handler = (method: string, params: unknown[]) => HandlerResult | Promise<HandlerResult>

const defaultHandler: Handler = () => '0x1'
let currentHandler: Handler = defaultHandler
let server: ReturnType<typeof createServer> | null = null

/** Override the handler for the next request(s).  Call per-test to customise. */
export function setMockArcRpcHandler(fn: Handler): void { currentHandler = fn }
/** Restore the default handler (returns '0x1' for everything). */
export function resetMockArcRpcHandler(): void { currentHandler = defaultHandler }

/**
 * Start the mock Arc RPC server and point arcRpc() at it.
 * Does NOT touch _setRpcTimeoutMsForTest — callers manage that themselves.
 */
export async function startMockArcRpc(): Promise<void> {
  if (server) return // idempotent
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      // If the client aborted (e.g. AbortController fired), the socket is already
      // closed; writing to res would throw.  Check before any write.
      if (res.destroyed || !res.writable) return

      let id: unknown = 1
      try {
        const parsed: { method: string; params?: unknown[]; id?: unknown } = JSON.parse(body)
        id = parsed.id
        const { method, params = [] } = parsed

        let result: HandlerResult
        try {
          // Await the handler so a Promise-returning handler (e.g. a hang simulation)
          // keeps the response pending until it resolves or the client aborts.
          result = await Promise.resolve(currentHandler(method, params))
        } catch (err) {
          if (res.destroyed || !res.writable) return
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: String(err) } }))
          return
        }

        if (res.destroyed || !res.writable) return
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
      } catch {
        if (res.destroyed || !res.writable) return
        res.writeHead(400)
        res.end('Bad request')
      }
    })
  })

  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  _setArcRpcUrlForTest(`http://127.0.0.1:${addr.port}`)
}

/** Stop the mock server and reset arcRpc() to the real URL. */
export async function stopMockArcRpc(): Promise<void> {
  _setArcRpcUrlForTest(undefined)
  resetMockArcRpcHandler()
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
}

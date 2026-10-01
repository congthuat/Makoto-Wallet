import { stringToHex } from 'viem'
import { api } from './api.ts'
import { getProvider } from './wallet.ts'

export type TaskSession = { authenticated: boolean; address: string | null }

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(api(`auth/${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Makoto-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof result?.code === 'string' ? result.code : 'AUTH_REQUEST_FAILED')
  return result as T
}

export const taskAuthApi = {
  session: () => authRequest<TaskSession>('session'),
  logout: () => authRequest<TaskSession>('logout', {}),
  async verifyWallet(address: string): Promise<TaskSession> {
    const provider = getProvider()
    if (!provider) throw new Error('AUTH_WALLET_REQUIRED')
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[]
    if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== address.toLowerCase()) throw new Error('AUTH_WALLET_MISMATCH')
    const { message } = await authRequest<{ message: string }>('nonce', { address, chainId: 5042002 })
    let signature: unknown
    try { signature = await provider.request({ method: 'personal_sign', params: [stringToHex(message), address] }) }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : undefined
      throw new Error(code === 4001 ? 'AUTH_SIGNATURE_REJECTED' : code === 4200 ? 'AUTH_SIGN_UNSUPPORTED' : 'AUTH_SIGN_FAILED')
    }
    if (typeof signature !== 'string') throw new Error('AUTH_SIGN_FAILED')
    const currentAccounts = await provider.request({ method: 'eth_accounts' }) as string[]
    if (!Array.isArray(currentAccounts) || currentAccounts[0]?.toLowerCase() !== address.toLowerCase()) throw new Error('AUTH_WALLET_MISMATCH')
    return authRequest<TaskSession>('verify', { message, signature })
  },
}

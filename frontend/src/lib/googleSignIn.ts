import { api } from './api'
import type { EncryptedVault } from './embeddedVault'

/** Public client id comes from the backend so it can be changed without a frontend rebuild. */
let configPromise: Promise<{ enabled: boolean; clientId: string | null }> | null = null
export function googleConfig() {
  configPromise ??= fetch(api('vault/config')).then((r) => (r.ok ? r.json() : { enabled: false, clientId: null })).catch(() => { configPromise = null; return { enabled: false, clientId: null } })
  return configPromise
}

declare global {
  interface Window { google?: { accounts?: { id?: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void; disableAutoSelect?: () => void } } } }
}

let gisPromise: Promise<void> | null = null
export function loadGoogleIdentity(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No browser'))
  if (window.google?.accounts?.id) return Promise.resolve()
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in.')) }
    document.head.appendChild(script)
  })
  return gisPromise
}

/** Reads (does not verify) the ID token payload for display/binding. The server verifies it with Google. */
export function readGoogleCredential(credential: string): { sub: string; email: string } {
  const part = credential.split('.')[1] ?? ''
  const json = JSON.parse(decodeURIComponent(escape(atob(part.replace(/-/g, '+').replace(/_/g, '/')))))
  return { sub: String(json.sub ?? ''), email: String(json.email ?? '') }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(api(`vault/${path}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json?.error || 'Request failed')
  return json as T
}

export type LookupResult = { exists: false; email: string } | { exists: true; email: string; address: string; vault: EncryptedVault }
export const vaultLookup = (credential: string) => post<LookupResult>('lookup', { credential })
export const vaultSave = (credential: string, address: string, vault: EncryptedVault) => post<{ ok: true; created: boolean }>('save', { credential, address, vault })

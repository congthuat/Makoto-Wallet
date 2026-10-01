import type { BrainIntent, BrainLocale, BrainPreparation } from './types'

const FULL_ADDRESS = /0x[a-fA-F0-9]{40}/
const ADDRESS_LIKE = /0x[^\s,;]+/i
const AMOUNT = /(?:^|\s)(-?\d+(?:[.,]\d+)?|max|all|everything|entire balance)(?=\s|[?!.,]|$)/i

const norm = (value: string) => value.toLocaleLowerCase('vi-VN').normalize('NFC')
const has = (value: string, terms: readonly string[]) => terms.some((term) => value.includes(term))
const assetOf = (value: string): string | undefined => value.includes('cirbtc') ? 'cirBTC' : value.includes('eurc') ? 'EURC' : value.includes('usdc') ? 'USDC' : undefined

function amountOf(raw: string) {
  const match = raw.match(AMOUNT)?.[1]
  if (!match) return undefined
  if (/^(max|all|everything|entire balance)$/i.test(match)) return 'MAX'
  return match.replace(',', '.')
}

function addressOf(raw: string) {
  return raw.match(FULL_ADDRESS)?.[0]
}

function invalidAddress(raw: string) {
  const candidate = raw.match(ADDRESS_LIKE)?.[0]
  return Boolean(candidate && !FULL_ADDRESS.test(candidate))
}

function chainsOf(text: string) {
  const arc = /\barc(?:\s+testnet)?\b/i.test(text)
  const base = /\bbase(?:\s+sepolia)?\b/i.test(text)
  return { arc, base }
}

function parsePreparation(raw: string, text: string): BrainPreparation | undefined {
  const amount = amountOf(raw)
  const recipient = addressOf(raw)
  const invalidRecipient = invalidAddress(raw)
  const asset = assetOf(text)

  if (has(text, ['swap', 'hoán đổi', 'đổi '])) {
    const mentions = [...text.matchAll(/\b(usdc|eurc)\b/g)].map((m) => m[1].toUpperCase() as string)
    const input = mentions[0] ?? asset
    const output = mentions[1] ?? (input === 'USDC' ? 'EURC' : input === 'EURC' ? 'USDC' : undefined)
    return Object.freeze({ kind: 'swap', rawUserText: raw, amount: amount === 'MAX' ? undefined : amount, maxRequested: amount === 'MAX', asset: input, outputAsset: output })
  }

  if (has(text, ['bridge', 'chuyển chuỗi', 'cross-chain', 'cross chain'])) {
    const chains = chainsOf(text)
    let sourceChain: BrainPreparation['sourceChain']
    let destinationChain: BrainPreparation['destinationChain']
    if (chains.arc && chains.base) {
      const arcPos = text.indexOf('arc')
      const basePos = text.indexOf('base')
      sourceChain = arcPos <= basePos ? 'Arc Testnet' : 'Base Sepolia'
      destinationChain = arcPos <= basePos ? 'Base Sepolia' : 'Arc Testnet'
    } else if (chains.base) {
      sourceChain = 'Arc Testnet'
      destinationChain = 'Base Sepolia'
    } else if (chains.arc) {
      sourceChain = 'Base Sepolia'
      destinationChain = 'Arc Testnet'
    }
    return Object.freeze({ kind: 'bridge', rawUserText: raw, amount: amount === 'MAX' ? undefined : amount, maxRequested: amount === 'MAX', asset: 'USDC', recipient, invalidRecipient, sourceChain, destinationChain })
  }

  if (has(text, ['send', 'transfer', 'gửi', 'chuyển ']) && (amount || recipient || asset)) {
    return Object.freeze({ kind: 'send', rawUserText: raw, amount: amount === 'MAX' ? undefined : amount, maxRequested: amount === 'MAX', asset, recipient, invalidRecipient })
  }

  return undefined
}

function activityFilter(text: string): BrainIntent['activityFilter'] {
  if (has(text, ['swap', 'hoán đổi'])) return 'swap'
  if (has(text, ['bridge', 'chuyển chuỗi'])) return 'bridge'
  if (has(text, ['receive', 'nhận'])) return 'receive'
  if (has(text, ['send', 'gửi'])) return 'send'
  return 'all'
}

const CURRENT_DATETIME_QUERY = /(?:what\s+time\s+is\s+it|what(?:'s|\s+is)\s+the\s+time|what\s+date\s+is\s+it|what\s+day\s+is\s+it\s+today|b\u00e2y\s*(?:gi\u1edd|h)(?:\s+l\u00e0)?\s+m\u1ea5y\s*(?:gi\u1edd|h)|m\u1ea5y\s*(?:gi\u1edd|h)\s+r\u1ed3i|gi\u1edd\s+hi\u1ec7n\s+t\u1ea1i|h\u00f4m\s+nay(?:\s+l\u00e0)?\s+(?:ng\u00e0y\s+)?(?:m\u1ea5y|bao\s+nhi\u00eau)|ng\u00e0y\s+h\u00f4m\s+nay)/i

export function parseBrainRequest(textInput: string, locale: BrainLocale = 'en'): BrainIntent {
  const raw = textInput.trim()
  const text = norm(raw)
  const preparation = parsePreparation(raw, text)
  if (preparation) return Object.freeze({ kind: 'prepare-action', locale, preparation })

  if (has(text, ['recent', 'last', 'history', 'activity', 'transaction', 'gần đây', 'gần nhất', 'lịch sử', 'giao dịch'])) {
    const limit = Math.min(20, Math.max(1, Number(text.match(/\b(\d{1,2})\b/)?.[1] ?? 5)))
    return Object.freeze({ kind: 'recent-activity', locale, activityFilter: activityFilter(text), limit })
  }
  if (CURRENT_DATETIME_QUERY.test(text)) return Object.freeze({ kind: 'current-datetime', locale })
  if (has(text, ['balance', 'portfolio', 'assets', 'holdings', 'holding', 'wallet summary', 'summarize my wallet', 'how much', 'bao nhiêu', 'số dư', 'tài sản', 'danh mục', 'tóm tắt ví'])) return Object.freeze({ kind: 'wallet-overview', locale })
  if (has(text, ['network', 'chain', 'mạng', 'chuỗi'])) return Object.freeze({ kind: 'network-status', locale })
  if (has(text, ['safety', 'safe', 'security', 'an toàn', 'bảo mật'])) return Object.freeze({ kind: 'safety-capabilities', locale })
  return Object.freeze({ kind: 'unknown', locale })
}

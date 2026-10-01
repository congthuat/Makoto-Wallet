// Legacy action and information sample scenarios. Persistent tasks use /api/tasks.

export type SendScenario = { kind: 'send'; asset: string; amount: string; recipient: string }
export type SwapScenario = { kind: 'swap'; asset: string; amount: string; toAsset: string }
export type BridgeScenario = { kind: 'bridge'; asset: string; amount: string; dest: string }
export type Scenario =
  | SendScenario | SwapScenario | BridgeScenario
  | { kind: 'portfolio' } | { kind: 'activity' }
  | { kind: 'unknown' }

export const SAMPLE_RECIPIENT = '0x1234567890AbCdEf1234567890aBcDeF12347890'

export const SAMPLE_PROMPTS = {
  send: 'Send 10 EURC to 0x1234…7890',
  swap: 'Swap 20 USDC to EURC',
  bridge: 'Bridge 10 USDC to Base Sepolia',
  portfolio: 'Check my portfolio',
  alert: 'Alert me when USDC balance is below 500',
  daily: 'Send me a daily portfolio summary at 08:00',
}

const has = (t: string, words: string[]) => words.some((w) => t.includes(w))

/** Route legacy free text to the closest fixed action/information sample. */
export function pickScenario(text: string): Scenario {
  const t = text.toLowerCase()
  if (has(t, ['swap', 'exchange', 'convert'])) return { kind: 'swap', asset: 'USDC', amount: '20', toAsset: 'EURC' }
  if (has(t, ['bridge', 'cctp', 'cross-chain'])) return { kind: 'bridge', asset: 'USDC', amount: '10', dest: 'Base Sepolia' }
  if (has(t, ['send', 'transfer', 'pay'])) return { kind: 'send', asset: 'EURC', amount: '10', recipient: SAMPLE_RECIPIENT }
  if (has(t, ['portfolio', 'balance', 'worth', 'holding', 'how much'])) return { kind: 'portfolio' }
  if (has(t, ['activity', 'history', 'recent', 'transaction'])) return { kind: 'activity' }
  return { kind: 'unknown' }
}

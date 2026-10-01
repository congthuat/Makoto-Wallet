import type { BrainIntent, BrainPreparation, BrainRouteDecision } from './types'

export function missingPreparation(input: BrainPreparation): readonly string[] {
  const missing: string[] = []
  if (!input.amount || !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(input.amount) || Number(input.amount) <= 0) missing.push('amount')
  if ((input.kind === 'send' || input.kind === 'swap') && !input.asset) missing.push('asset')
  if (input.kind === 'send' && !input.recipient) missing.push('recipient')
  if (input.kind === 'swap' && !input.outputAsset) missing.push('outputAsset')
  if (input.kind === 'bridge' && !input.sourceChain) missing.push('sourceChain')
  if (input.kind === 'bridge' && !input.destinationChain) missing.push('destinationChain')
  return Object.freeze(missing)
}

function blockersFor(input: BrainPreparation) {
  const blockers: string[] = []
  if (input.maxRequested) blockers.push('Agent MAX requests require the manual flow.')
  if (input.invalidRecipient) blockers.push('Recipient address is malformed.')
  if (input.recipient === '0x0000000000000000000000000000000000000000') blockers.push('Zero address is blocked.')
  if (input.kind === 'swap' && input.asset && input.outputAsset && input.asset === input.outputAsset) blockers.push('Swap input and output assets must differ.')
  if (input.kind === 'bridge' && input.sourceChain && input.destinationChain && input.sourceChain === input.destinationChain) blockers.push('Bridge source and destination must differ.')
  return Object.freeze(blockers)
}

export function routeBrainIntent(intent: BrainIntent): BrainRouteDecision {
  if (intent.kind === 'prepare-action' && intent.preparation) {
    const missingFields = missingPreparation(intent.preparation)
    const blockers = blockersFor(intent.preparation)
    const valid = missingFields.length === 0 && blockers.length === 0
    return Object.freeze({
      topic: intent.preparation.kind,
      mode: valid ? 'preparation' : 'clarification',
      capabilityId: valid ? (`${intent.preparation.kind}_preparation` as BrainRouteDecision['capabilityId']) : 'clarification',
      draftAllowed: valid,
      missingFields,
      blockers,
    })
  }
  if (intent.kind === 'wallet-overview') return Object.freeze({ topic: 'wallet', mode: 'informational', capabilityId: 'wallet_overview', draftAllowed: false, missingFields: Object.freeze([]), blockers: Object.freeze([]) })
  if (intent.kind === 'recent-activity') return Object.freeze({ topic: 'activity', mode: 'informational', capabilityId: 'recent_activity', draftAllowed: false, missingFields: Object.freeze([]), blockers: Object.freeze([]) })
  if (intent.kind === 'network-status') return Object.freeze({ topic: 'network', mode: 'informational', capabilityId: 'network_status', draftAllowed: false, missingFields: Object.freeze([]), blockers: Object.freeze([]) })
  if (intent.kind === 'current-datetime') return Object.freeze({ topic: 'datetime', mode: 'informational', capabilityId: 'current_datetime', draftAllowed: false, missingFields: Object.freeze([]), blockers: Object.freeze([]) })
  if (intent.kind === 'safety-capabilities') return Object.freeze({ topic: 'safety', mode: 'informational', capabilityId: 'safety_capabilities', draftAllowed: false, missingFields: Object.freeze([]), blockers: Object.freeze([]) })
  return Object.freeze({ topic: 'unknown', mode: 'clarification', capabilityId: 'unknown', draftAllowed: false, missingFields: Object.freeze([]), blockers: Object.freeze([]) })
}

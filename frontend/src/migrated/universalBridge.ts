import type { ToolResult } from './toolLayer.ts'

/** App Kit bridge() performs multiple SDK-controlled writes. No step-level unsigned prepare API is present in the inspected donor integration. */
export const UNIVERSAL_BRIDGE_BLOCKER = 'Circle App Kit bridge() controls approval and burn inside one SDK operation; Makoto cannot separately freeze, review and revalidate each unsigned wallet request.'

export function universalBridgeAvailability(): ToolResult<never> {
  return Object.freeze({ status: 'UNAVAILABLE', source: 'Circle App Kit adapter', observedAt: Date.now(), reason: UNIVERSAL_BRIDGE_BLOCKER })
}

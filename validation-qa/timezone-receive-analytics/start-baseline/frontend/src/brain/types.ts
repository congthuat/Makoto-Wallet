export type BrainLocale = 'en' | 'vi'
export type BrainActionKind = 'send' | 'swap' | 'bridge'
export type BrainReadKind = 'wallet-overview' | 'recent-activity' | 'network-status' | 'current-datetime' | 'safety-capabilities' | 'unknown'
export type BrainKind = BrainReadKind | 'prepare-action'

export type BrainPreparation = Readonly<{
  kind: BrainActionKind
  rawUserText: string
  amount?: string
  asset?: string
  outputAsset?: string
  recipient?: string
  sourceChain?: string
  destinationChain?: string
  invalidRecipient?: boolean
  maxRequested?: boolean
}>

export type BrainIntent = Readonly<{
  kind: BrainKind
  locale: BrainLocale
  preparation?: BrainPreparation
  activityFilter?: 'send' | 'receive' | 'swap' | 'bridge' | 'all'
  limit?: number
}>

export type BrainCapability =
  | 'wallet_overview'
  | 'recent_activity'
  | 'network_status'
  | 'current_datetime'
  | 'safety_capabilities'
  | 'send_preparation'
  | 'swap_preparation'
  | 'bridge_preparation'
  | 'clarification'
  | 'unknown'

export type BrainRouteDecision = Readonly<{
  topic: 'wallet' | 'activity' | 'network' | 'datetime' | 'safety' | BrainActionKind | 'unknown'
  mode: 'informational' | 'preparation' | 'clarification'
  capabilityId: BrainCapability
  draftAllowed: boolean
  missingFields: readonly string[]
  blockers: readonly string[]
}>

export type BrainSafetyStatus = 'ready' | 'review' | 'blocked' | 'unknown'
export type BrainCheckStatus = 'pass' | 'warning' | 'blocked' | 'unknown'
export type BrainCheck = Readonly<{ code: string; status: BrainCheckStatus; message: string }>

export type BrainSafetyAssessment = Readonly<{
  status: BrainSafetyStatus
  checks: readonly BrainCheck[]
  blockers: readonly string[]
  warnings: readonly string[]
  fingerprint: string
  assessedAt: number
}>

export type BrainContext = Readonly<{
  connected: boolean
  account?: string
  chainId?: number
  balances?: Partial<Record<string, number>>
  knownRecipients?: readonly string[]
  now?: number
}>

export type BrainReviewSnapshot = Readonly<{
  action: BrainPreparation
  contextAccount?: string
  contextChainId?: number
  fingerprint: string
  preparedAt: number
  expiresAt: number
  assessment: BrainSafetyAssessment
}>

export type BrainHandoff = Readonly<{
  id: string
  source: 'makoto-agent'
  action: BrainActionKind
  account: string
  createdAt: number
  expiresAt: number
  amount: string
  asset?: string
  outputAsset?: string
  recipient?: string
  sourceChain?: string
  destinationChain?: string
}>

export type BrainLifecycleStage =
  | 'prepared'
  | 'awaiting-wallet'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'unknown'

export type BrainLifecycle = Readonly<{
  stage: BrainLifecycleStage
  hash?: string
  message?: string
  updatedAt: number
  retrySafe: boolean
}>

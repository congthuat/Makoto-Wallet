// Product labels only. Agent/planner/transaction state values remain unchanged.
const STATUS_LABELS: Record<string, string> = {
  READY_APPROVAL: 'Approval required',
  READY_ACTION: 'Ready for review',
  READY_HANDOFF: 'Ready to review in Send',
  WAITING_RECEIPT: 'Pending',
  BLOCKED: 'Blocked',
  UNAVAILABLE: 'Unavailable',
  pending: 'Pending',
  submitted: 'Submitted',
  confirmed: 'Confirmed',
  completed: 'Completed',
  failed: 'Failed',
  unknown: 'Status unknown',
  user_rejected: 'Wallet request cancelled',
}

export function agentStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? 'Status unknown'
}

const FIELD_LABELS: Record<string, string> = {
  amount: 'Amount', asset: 'Asset', recipient: 'Recipient',
  outputAsset: 'Receive', sourceChain: 'Source', destinationChain: 'Destination',
}

export function agentFieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

export type SubscriptionLevel = 'expired' | 'expiringSoon' | 'active'

export type SubscriptionState = {
  level: SubscriptionLevel
  isExpired: boolean
  isExpiringSoon: boolean
  daysUntilDue: number | null
  color: string
  chipColor: 'error' | 'warning' | 'success'
}

const LEVEL_STYLE: Record<SubscriptionLevel, { color: string; chipColor: SubscriptionState['chipColor'] }> = {
  expired: { color: '#f44336', chipColor: 'error' },
  expiringSoon: { color: '#ff9800', chipColor: 'warning' },
  active: { color: '#4caf50', chipColor: 'success' },
}

/** i18n key, under `subscription`, of the label of each level. */
export const SUBSCRIPTION_LEVEL_LABEL: Record<SubscriptionLevel, 'inactive' | 'expiringSoon' | 'active'> = {
  expired: 'inactive',
  expiringSoon: 'expiringSoon',
  active: 'active',
}

/** Status of a node's Proxmox subscription: expired, due within 30 days, or active. */
export function hostSubscriptionState(subscription: { status?: string; nextDueDate?: string }, now = Date.now()): SubscriptionState {
  const isActive = subscription.status === 'active'
  const nextDueDate = subscription.nextDueDate ? new Date(subscription.nextDueDate) : null
  const daysUntilDue = nextDueDate ? Math.ceil((nextDueDate.getTime() - now) / (1000 * 60 * 60 * 24)) : null
  const isExpiringSoon = isActive && daysUntilDue !== null && daysUntilDue <= 30 && daysUntilDue > 0
  const isExpired = !isActive || (daysUntilDue !== null && daysUntilDue <= 0)

  let level: SubscriptionLevel = 'active'
  if (isExpired) level = 'expired'
  else if (isExpiringSoon) level = 'expiringSoon'

  return { level, isExpired, isExpiringSoon, daysUntilDue, ...LEVEL_STYLE[level] }
}

// src/lib/notifications/channels.ts
//
// Shared vocabulary of the notification channels (Slack, Teams, ntfy, Discord,
// generic webhook) the orchestrator delivers alerts to next to email. The
// channels live in the orchestrator's database; this app only proxies the
// calls, so the shapes here mirror internal/notifications/channels.go.
//
// Imported by the Settings UI: no server-only import here.

export const CHANNEL_TYPES = ['slack', 'teams', 'ntfy', 'discord', 'webhook'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]

/** Notification types a channel can subscribe to; an empty list means all. */
export const CHANNEL_NOTIFICATION_TYPES = ['alert', 'event', 'migration', 'backup', 'replication', 'maintenance', 'report'] as const
export type ChannelNotificationType = (typeof CHANNEL_NOTIFICATION_TYPES)[number]

export const CHANNEL_SEVERITIES = ['info', 'success', 'warning', 'critical'] as const
export type ChannelSeverity = (typeof CHANNEL_SEVERITIES)[number]

/** Icon and brand colour of each receiver kind, for the row glyph. */
export const CHANNEL_TYPE_META: Record<ChannelType, { icon: string; color: string }> = {
  slack: { icon: 'ri-slack-line', color: '#4A154B' },
  teams: { icon: 'ri-microsoft-line', color: '#5B5FC7' },
  ntfy: { icon: 'ri-notification-badge-line', color: '#338574' },
  discord: { icon: 'ri-discord-line', color: '#5865F2' },
  webhook: { icon: 'ri-webhook-line', color: '#6366f1' },
}

/** Placeholder shown in the URL field per type. */
export const CHANNEL_URL_PLACEHOLDER: Record<ChannelType, string> = {
  slack: 'https://hooks.slack.com/services/T000/B000/XXXX',
  teams: 'https://prod-00.westeurope.logic.azure.com:443/workflows/.../triggers/manual/paths/invoke?...',
  ntfy: 'https://ntfy.sh/proxcenter-alerts',
  discord: 'https://discord.com/api/webhooks/0000/XXXX',
  webhook: 'https://relay.example.com/proxcenter',
}

/** What the orchestrator returns: no secret, a masked URL, presence flags. */
export type NotificationChannel = {
  id: string
  name: string
  type: ChannelType
  enabled: boolean
  url_masked: string
  has_secret: boolean
  has_header_value: boolean
  header_name: string
  types: ChannelNotificationType[]
  min_severity: ChannelSeverity
  allow_private_network: boolean
  last_status: '' | 'sent' | 'failed'
  last_error: string
  last_sent_at?: string | null
  last_error_at?: string | null
  sent_count: number
  failed_count: number
  created_at?: string
  updated_at?: string
}

/**
 * What the UI sends. On update, an empty url / secret / header_value keeps
 * the stored one and the clear_* flags drop it.
 */
export type ChannelInput = {
  name: string
  type: ChannelType
  enabled: boolean
  url: string
  secret: string
  clear_secret?: boolean
  header_name: string
  header_value: string
  clear_header_value?: boolean
  types: ChannelNotificationType[]
  min_severity: ChannelSeverity
  allow_private_network: boolean
}

export function newChannelInput(): ChannelInput {
  return {
    name: '',
    type: 'slack',
    enabled: true,
    url: '',
    secret: '',
    header_name: '',
    header_value: '',
    types: [],
    min_severity: 'warning',
    allow_private_network: false,
  }
}

/** Edit form seeded from a stored channel: the secrets start blank (unchanged). */
export function channelToInput(ch: NotificationChannel): ChannelInput {
  return {
    name: ch.name,
    type: ch.type,
    enabled: ch.enabled,
    url: '',
    secret: '',
    header_name: ch.header_name ?? '',
    header_value: '',
    types: ch.types ?? [],
    min_severity: ch.min_severity || 'warning',
    allow_private_network: Boolean(ch.allow_private_network),
  }
}

/** Whether the type carries a secret beside the URL, and what it is. */
export function channelSecretKind(type: ChannelType): 'token' | 'hmac' | null {
  if (type === 'ntfy') return 'token'
  if (type === 'webhook') return 'hmac'

  return null
}

export type ChannelHealth = 'disabled' | 'idle' | 'ok' | 'error'

export function channelHealth(ch: NotificationChannel): ChannelHealth {
  if (!ch.enabled) return 'disabled'
  if (ch.last_status === 'failed') return 'error'
  if (ch.last_status === 'sent') return 'ok'

  return 'idle'
}

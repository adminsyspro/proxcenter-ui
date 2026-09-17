// src/lib/syslog/types.ts
//
// Shared vocabulary of the audit-to-syslog forwarder (issue #184): the
// destination shape persisted in the `settings` table, its validation schema,
// and the event shape the forwarder receives from `audit()`.
//
// This module is imported by the Settings UI too, so it must stay free of any
// server-only import (Prisma, next/headers, node built-ins).

import { z } from 'zod'

import type { AuditCategory } from '@/lib/audit'

export const SYSLOG_SETTING_KEY = 'syslog_destinations'
export const MAX_SYSLOG_DESTINATIONS = 20

export const SYSLOG_TRANSPORTS = ['udp', 'tcp', 'tls'] as const
export type SyslogTransport = (typeof SYSLOG_TRANSPORTS)[number]

export const SYSLOG_FORMATS = ['rfc5424', 'rfc3164', 'cef'] as const
export type SyslogFormat = (typeof SYSLOG_FORMATS)[number]

/**
 * RFC 6587 framing for stream transports. Newline (non-transparent) is what
 * Splunk, Graylog, Wazuh and rsyslog's imtcp accept out of the box; octet
 * counting is the RFC 5425 requirement for TLS and what syslog-ng prefers.
 */
export const SYSLOG_FRAMINGS = ['newline', 'octet-counting'] as const
export type SyslogFraming = (typeof SYSLOG_FRAMINGS)[number]

/** RFC 5424 section 6.2.1 facilities offered in the UI. 13 ("log audit") is the default. */
export const SYSLOG_FACILITIES: ReadonlyArray<{ code: number; label: string }> = [
  { code: 13, label: 'log audit' },
  { code: 4, label: 'auth' },
  { code: 10, label: 'authpriv' },
  { code: 1, label: 'user' },
  { code: 16, label: 'local0' },
  { code: 17, label: 'local1' },
  { code: 18, label: 'local2' },
  { code: 19, label: 'local3' },
  { code: 20, label: 'local4' },
  { code: 21, label: 'local5' },
  { code: 22, label: 'local6' },
  { code: 23, label: 'local7' },
]

/**
 * Runtime copy of the AuditCategory union (src/lib/audit/index.ts). The
 * `satisfies` clause makes TypeScript refuse a typo here, and the type-only
 * import is erased at build time so the client bundle never pulls the audit
 * module (which imports next/headers).
 */
export const AUDIT_CATEGORIES = [
  'auth',
  'users',
  'connections',
  'vms',
  'containers',
  'nodes',
  'storage',
  'backups',
  'settings',
  'system',
  'security',
  'templates',
  'migration',
  'admin',
  'sdn',
  'api_tokens',
] as const satisfies readonly AuditCategory[]

export const syslogTlsSchema = z.object({
  /** Verify the server certificate against the CA below (or the system store). */
  verify: z.boolean().default(true),
  /** Optional PEM bundle of the CA that signed the collector certificate. */
  ca: z.string().max(65536).default(''),
  /** SNI / hostname to verify, when the collector is reached through an IP. */
  serverName: z.string().trim().max(253).default(''),
})

export const syslogDestinationSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(64),
  enabled: z.boolean().default(true),
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  transport: z.enum(SYSLOG_TRANSPORTS),
  format: z.enum(SYSLOG_FORMATS).default('rfc5424'),
  framing: z.enum(SYSLOG_FRAMINGS).default('newline'),
  facility: z.number().int().min(0).max(23).default(13),
  /** Empty means every audit category is forwarded. */
  categories: z.array(z.enum(AUDIT_CATEGORIES)).max(AUDIT_CATEGORIES.length).default([]),
  tls: syslogTlsSchema.default({ verify: true, ca: '', serverName: '' }),
})

export type SyslogDestination = z.infer<typeof syslogDestinationSchema>
export type SyslogDestinationInput = z.input<typeof syslogDestinationSchema>

export const syslogConfigSchema = z.object({
  version: z.literal(1).default(1),
  destinations: z.array(syslogDestinationSchema).max(MAX_SYSLOG_DESTINATIONS).default([]),
})

export type SyslogConfig = z.infer<typeof syslogConfigSchema>

export const EMPTY_SYSLOG_CONFIG: SyslogConfig = { version: 1, destinations: [] }

export function defaultSyslogPort(transport: SyslogTransport): number {
  return transport === 'tls' ? 6514 : 514
}

/** The audit row as the forwarder sees it, right after `audit()` wrote it. */
export interface SyslogAuditEvent {
  id: string
  timestamp: Date
  tenantId: string
  userId: string | null
  userEmail: string | null
  apiTokenId: string | null
  action: string
  category: string
  resourceType: string | null
  resourceId: string | null
  resourceName: string | null
  details: unknown
  ipAddress: string | null
  userAgent: string | null
  status: string
  errorMessage: string | null
}

/** Live counters of one destination, kept in memory by its sender. */
export interface SyslogDestinationStatus {
  /** Stream transports: a socket is open. UDP: a socket exists (no delivery signal). */
  connected: boolean
  sent: number
  dropped: number
  failed: number
  lastSentAt: string | null
  lastError: string | null
  lastErrorAt: string | null
}

export function emptySyslogStatus(): SyslogDestinationStatus {
  return { connected: false, sent: 0, dropped: 0, failed: 0, lastSentAt: null, lastError: null, lastErrorAt: null }
}

// src/lib/syslog/format.ts
//
// Pure rendering of an audit event into one syslog line. Three dialects:
//   - RFC 5424 (default): structured data carries every audit field, so a
//     SIEM parses them without a custom regex.
//   - RFC 3164 (BSD): for legacy collectors; fields travel as key="value"
//     pairs at the end of the message.
//   - CEF over a BSD header: ArcSight, Microsoft Sentinel, QRadar, Splunk CIM.
//
// No I/O here. Everything network-related lives in transport.ts.

import { APP_VERSION } from '@/config/version'

import type { SyslogAuditEvent, SyslogDestination } from './types'

/**
 * SD-ID of the ProxCenter structured-data element. RFC 5424 requires a
 * private-enterprise-number suffix on non-IANA SD-IDs; 32473 is the PEN
 * reserved for documentation (RFC 5612), used here until ProxCenter holds one.
 */
export const SYSLOG_SD_ID = 'proxcenter@32473'
export const SYSLOG_APP_NAME = 'proxcenter'
export const CEF_VENDOR = 'ProxCenter'
export const CEF_PRODUCT = 'ProxCenter'

/** Longest `details` payload copied into a line, in characters. */
export const MAX_DETAILS_CHARS = 4096
const MAX_USER_AGENT_CHARS = 256
const MAX_ERROR_CHARS = 1024

export interface FormatContext {
  hostname: string
  pid: number
  appName?: string
  version?: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** RFC 5424 severity: success=6 informational, warning=4 warning, anything else=3 error. */
export function severityFor(status: string): number {
  if (status === 'success') return 6
  if (status === 'warning') return 4
  return 3
}

/** CEF severity on its 0-10 scale, aligned with severityFor(). */
export function cefSeverityFor(status: string): number {
  if (status === 'success') return 3
  if (status === 'warning') return 6
  return 8
}

export function priority(facility: number, severity: number): number {
  return facility * 8 + severity
}

/** RFC 5424 PRINTUSASCII, no spaces; used for HOSTNAME, APP-NAME, MSGID, PROCID. */
export function headerToken(value: string | null | undefined, max: number): string {
  if (!value) return '-'
  const cleaned = value.replace(/[^\x21-\x7e]/g, '_').slice(0, max)
  return cleaned || '-'
}

/** RFC 5424 PARAM-VALUE escaping: backslash, double quote and closing bracket. */
export function escapeSdParam(value: string): string {
  return value.replace(/[\\"\]]/g, ch => `\\${ch}`)
}

/** Any control character (including newlines) becomes a space so a line stays one line. */
export function stripControl(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, ' ')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/**
 * Keys whose value never leaves the box. The audit table may hold an encrypted
 * SSH password or a freshly created token inside `details`; the database is
 * ours, the SIEM is not. Identifiers, names and prefixes that merely mention a
 * token or a key (`tokenId`, `keyName`, `prefix`) stay, they are the trail.
 */
const SENSITIVE_KEY = /pass(word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|credential|authorization|cookie|otp/i
const HARMLESS_SUFFIX = /(id|name|prefix|method|type|enabled|count|ttl|expires?(at)?|scopes?)$/i
const MAX_REDACT_DEPTH = 8

export const REDACTED = '[redacted]'

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) && !HARMLESS_SUFFIX.test(key)
}

/** Deep copy of `value` with every sensitive leaf replaced by REDACTED. */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > MAX_REDACT_DEPTH) return value
  if (Array.isArray(value)) return value.map(v => redactSensitive(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k) && v !== null && v !== undefined && v !== '') {
      out[k] = REDACTED
    } else {
      out[k] = redactSensitive(v, depth + 1)
    }
  }
  return out
}

/** `::ffff:10.0.0.1` is how Node reports an IPv4 peer on a dual-stack socket; SIEMs want `10.0.0.1`. */
export function normalizeIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  const m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)
  return m ? m[1] : ip
}

export function detailsToString(details: unknown): string | null {
  if (details === null || details === undefined) return null
  let text: string
  if (typeof details === 'string') {
    text = details
  } else {
    try {
      text = JSON.stringify(redactSensitive(details))
    } catch {
      text = String(details)
    }
  }
  if (!text || text === '{}' || text === 'null') return null
  return truncate(stripControl(text), MAX_DETAILS_CHARS)
}

export function actorOf(evt: SyslogAuditEvent): string {
  if (evt.userEmail) return evt.userEmail
  if (evt.userId) return evt.userId
  if (evt.apiTokenId) return `token:${evt.apiTokenId}`
  return 'anonymous'
}

/** The free-text part, identical across dialects so an operator recognises it anywhere. */
export function humanMessage(evt: SyslogAuditEvent): string {
  const parts: string[] = [actorOf(evt), evt.action]
  if (evt.resourceType) parts.push(evt.resourceType)
  if (evt.resourceId) parts.push(evt.resourceId)
  if (evt.resourceName) parts.push(`(${evt.resourceName})`)
  const ip = normalizeIp(evt.ipAddress)
  if (ip && ip !== 'unknown') parts.push(`from ${ip}`)
  let text = `${parts.join(' ')}: ${evt.status}`
  if (evt.errorMessage) text += ` (${truncate(evt.errorMessage, MAX_ERROR_CHARS)})`
  return stripControl(text)
}

/** Ordered audit fields shared by the RFC 5424 SD element and the RFC 3164 key/value tail. */
export function auditFields(evt: SyslogAuditEvent): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ['event_id', evt.id],
    ['tenant', evt.tenantId],
    ['user', evt.userEmail ?? '-'],
    ['user_id', evt.userId ?? '-'],
    ['token_id', evt.apiTokenId ?? '-'],
    ['category', evt.category],
    ['action', evt.action],
    ['status', evt.status],
  ]
  if (evt.resourceType) fields.push(['resource_type', evt.resourceType])
  if (evt.resourceId) fields.push(['resource_id', evt.resourceId])
  if (evt.resourceName) fields.push(['resource_name', evt.resourceName])
  const ip = normalizeIp(evt.ipAddress)
  if (ip && ip !== 'unknown') fields.push(['ip', ip])
  if (evt.userAgent) fields.push(['user_agent', truncate(evt.userAgent, MAX_USER_AGENT_CHARS)])
  if (evt.errorMessage) fields.push(['error', truncate(evt.errorMessage, MAX_ERROR_CHARS)])
  const details = detailsToString(evt.details)
  if (details) fields.push(['details', details])
  return fields.map(([k, v]) => [k, stripControl(v)])
}

export function formatRfc5424(evt: SyslogAuditEvent, dest: SyslogDestination, ctx: FormatContext): string {
  const pri = priority(dest.facility, severityFor(evt.status))
  const sd = auditFields(evt)
    .map(([k, v]) => `${k}="${escapeSdParam(v)}"`)
    .join(' ')
  const header = [
    `<${pri}>1`,
    evt.timestamp.toISOString(),
    headerToken(ctx.hostname, 255),
    headerToken(ctx.appName ?? SYSLOG_APP_NAME, 48),
    headerToken(String(ctx.pid), 128),
    headerToken(evt.action, 32),
  ].join(' ')
  return `${header} [${SYSLOG_SD_ID} ${sd}] ${humanMessage(evt)}`
}

/** "Sep  7 09:36:16" in UTC, day space-padded as the BSD format requires. */
export function rfc3164Timestamp(date: Date): string {
  const month = MONTHS[date.getUTCMonth()]
  const day = String(date.getUTCDate()).padStart(2, ' ')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mm = String(date.getUTCMinutes()).padStart(2, '0')
  const ss = String(date.getUTCSeconds()).padStart(2, '0')
  return `${month} ${day} ${hh}:${mm}:${ss}`
}

function bsdHeader(evt: SyslogAuditEvent, dest: SyslogDestination, ctx: FormatContext): string {
  const pri = priority(dest.facility, severityFor(evt.status))
  return `<${pri}>${rfc3164Timestamp(evt.timestamp)} ${headerToken(ctx.hostname, 255)}`
}

export function formatRfc3164(evt: SyslogAuditEvent, dest: SyslogDestination, ctx: FormatContext): string {
  const tag = `${headerToken(ctx.appName ?? SYSLOG_APP_NAME, 32)}[${ctx.pid}]`
  const kv = auditFields(evt)
    .map(([k, v]) => `${k}="${v.replace(/"/g, "'")}"`)
    .join(' ')
  return `${bsdHeader(evt, dest, ctx)} ${tag}: ${humanMessage(evt)} ${kv}`
}

/** CEF header fields: escape backslash and pipe. */
export function cefHeaderEscape(value: string): string {
  return stripControl(value).replace(/[\\|]/g, ch => `\\${ch}`)
}

/** CEF extension values: escape backslash and equals sign, encode newlines. */
export function cefExtensionEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/\r?\n/g, '\\n')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ' ')
}

export function formatCef(evt: SyslogAuditEvent, dest: SyslogDestination, ctx: FormatContext): string {
  const ext: Array<[string, string]> = [
    ['rt', String(evt.timestamp.getTime())],
    ['externalId', evt.id],
    ['act', evt.action],
    ['cat', evt.category],
    ['outcome', evt.status],
    ['suser', evt.userEmail ?? actorOf(evt)],
    ['dvchost', ctx.hostname],
  ]
  if (evt.userId) ext.push(['suid', evt.userId])
  const ip = normalizeIp(evt.ipAddress)
  if (ip && ip !== 'unknown') ext.push(['src', ip])
  if (evt.userAgent) ext.push(['requestClientApplication', truncate(evt.userAgent, MAX_USER_AGENT_CHARS)])
  ext.push(['cs1Label', 'tenant'], ['cs1', evt.tenantId])
  if (evt.resourceType) ext.push(['cs2Label', 'resourceType'], ['cs2', evt.resourceType])
  if (evt.resourceId) ext.push(['cs3Label', 'resourceId'], ['cs3', evt.resourceId])
  if (evt.resourceName) ext.push(['cs4Label', 'resourceName'], ['cs4', evt.resourceName])
  if (evt.apiTokenId) ext.push(['cs5Label', 'apiTokenId'], ['cs5', evt.apiTokenId])
  const details = detailsToString(evt.details)
  if (details) ext.push(['cs6Label', 'details'], ['cs6', details])
  if (evt.errorMessage) ext.push(['reason', truncate(evt.errorMessage, MAX_ERROR_CHARS)])
  ext.push(['msg', humanMessage(evt)])

  const header = [
    'CEF:0',
    cefHeaderEscape(CEF_VENDOR),
    cefHeaderEscape(CEF_PRODUCT),
    cefHeaderEscape(ctx.version ?? APP_VERSION),
    cefHeaderEscape(`${evt.category}.${evt.action}`),
    cefHeaderEscape(`${evt.category} ${evt.action}`),
    String(cefSeverityFor(evt.status)),
  ].join('|')
  const extension = ext.map(([k, v]) => `${k}=${cefExtensionEscape(v)}`).join(' ')
  return `${bsdHeader(evt, dest, ctx)} ${header}|${extension}`
}

export function formatSyslogMessage(evt: SyslogAuditEvent, dest: SyslogDestination, ctx: FormatContext): string {
  switch (dest.format) {
    case 'rfc3164':
      return formatRfc3164(evt, dest, ctx)
    case 'cef':
      return formatCef(evt, dest, ctx)
    default:
      return formatRfc5424(evt, dest, ctx)
  }
}

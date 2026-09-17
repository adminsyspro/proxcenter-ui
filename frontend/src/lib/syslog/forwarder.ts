// src/lib/syslog/forwarder.ts
//
// Fan-out of audit rows to the configured syslog destinations. Called by
// `audit()` right after the row is committed, fire-and-forget: nothing in
// here may throw, block, or fail the action the user just performed.
//
// State lives on globalThis under a Symbol.for key so that the two module
// instances Next dev can create (a route compiled after a background task
// gets its own copy of every module) share the same sockets, config cache
// and counters instead of opening one connection per instance.

import os from 'node:os'

import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { getSetting, setSetting } from '@/lib/db/settings'
import { Features } from '@/lib/license/features'

import { formatSyslogMessage, type FormatContext } from './format'
import { SyslogSender, sendOnce, type SendOnceResult } from './transport'
import {
  EMPTY_SYSLOG_CONFIG,
  SYSLOG_SETTING_KEY,
  emptySyslogStatus,
  syslogConfigSchema,
  type SyslogAuditEvent,
  type SyslogConfig,
  type SyslogDestination,
  type SyslogDestinationStatus,
} from './types'

const PROVIDER_TENANT = 'default'
const CONFIG_TTL_MS = 30_000
const LICENSE_TTL_MS = 60_000
/**
 * How long a positive license verdict keeps forwarding alive while the
 * orchestrator is unreachable. The fail-closed fallback would otherwise cut
 * the compliance feed for the duration of every orchestrator restart, and an
 * audit trail with holes is the one thing a SIEM feed must not produce.
 */
const LICENSE_GRACE_MS = 24 * 60 * 60 * 1000
const WARN_EVERY_MS = 5 * 60 * 1000

interface Registry {
  senders: Map<string, { fingerprint: string; sender: SyslogSender }>
  config: { value: SyslogConfig; at: number } | null
  license: { value: boolean; at: number; resolvedAt: number } | null
  warnedAt: number
}

const REGISTRY_KEY = Symbol.for('proxcenter.syslog.registry')

function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  let reg = g[REGISTRY_KEY]
  if (!reg) {
    reg = { senders: new Map(), config: null, license: null, warnedAt: 0 }
    g[REGISTRY_KEY] = reg
  }
  return reg
}

/** Indirection so tests can stub the license probe without touching the orchestrator. */
export const _impl = {
  hasServerFeature,
  now: () => Date.now(),
}

export function formatContext(): FormatContext {
  return { hostname: os.hostname(), pid: process.pid }
}

// ---- configuration ---------------------------------------------------------

/** Parse whatever the settings row holds; a corrupt row yields an empty config, never a throw. */
export function parseSyslogConfig(raw: unknown): SyslogConfig {
  const parsed = syslogConfigSchema.safeParse(raw ?? EMPTY_SYSLOG_CONFIG)
  return parsed.success ? parsed.data : { ...EMPTY_SYSLOG_CONFIG }
}

export async function loadSyslogConfig(force = false): Promise<SyslogConfig> {
  const reg = registry()
  const now = _impl.now()
  if (!force && reg.config && now - reg.config.at < CONFIG_TTL_MS) return reg.config.value
  const raw = await getSetting<unknown>(SYSLOG_SETTING_KEY, PROVIDER_TENANT)
  const value = parseSyslogConfig(raw)
  reg.config = { value, at: now }
  return value
}

export async function saveSyslogConfig(config: SyslogConfig): Promise<SyslogConfig> {
  const value = syslogConfigSchema.parse(config)
  await setSetting(SYSLOG_SETTING_KEY, PROVIDER_TENANT, value)
  registry().config = { value, at: _impl.now() }
  reconcileSenders(value)
  return value
}

export function invalidateSyslogConfig(): void {
  registry().config = null
}

// ---- senders ---------------------------------------------------------------

/** Only the fields whose change requires a new socket. */
export function transportFingerprint(dest: SyslogDestination): string {
  return JSON.stringify([dest.host, dest.port, dest.transport, dest.framing, dest.tls])
}

function senderFor(dest: SyslogDestination): SyslogSender {
  const reg = registry()
  const fingerprint = transportFingerprint(dest)
  const current = reg.senders.get(dest.id)
  if (current && current.fingerprint === fingerprint) {
    // Format, facility and category filters are read from `dest` at send
    // time, so a sender survives those edits without reconnecting.
    return current.sender
  }
  if (current) current.sender.close()
  const sender = new SyslogSender(dest)
  reg.senders.set(dest.id, { fingerprint, sender })
  return sender
}

/** Close senders of destinations that were removed or disabled. */
export function reconcileSenders(config: SyslogConfig): void {
  const reg = registry()
  const live = new Set(config.destinations.filter(d => d.enabled).map(d => d.id))
  for (const [id, entry] of reg.senders) {
    if (!live.has(id)) {
      entry.sender.close()
      reg.senders.delete(id)
    }
  }
}

export function getSyslogStatus(): Record<string, SyslogDestinationStatus> {
  const out: Record<string, SyslogDestinationStatus> = {}
  for (const [id, entry] of registry().senders) out[id] = { ...entry.sender.status }
  return out
}

// ---- license ---------------------------------------------------------------

async function forwardingLicensed(): Promise<boolean> {
  const reg = registry()
  const now = _impl.now()
  if (reg.license && now - reg.license.at < LICENSE_TTL_MS) return reg.license.value

  const verdict = await _impl.hasServerFeature(Features.SYSLOG_FORWARDING)
  if (verdict) {
    reg.license = { value: true, at: now, resolvedAt: now }
    return true
  }
  // A denial may be the fail-closed fallback of an unreachable orchestrator.
  // Keep the last positive verdict for a bounded grace period so a restart
  // does not punch a hole in the SIEM feed; a real downgrade still wins once
  // the grace period ends.
  if (reg.license?.value && now - reg.license.resolvedAt < LICENSE_GRACE_MS) {
    reg.license = { ...reg.license, at: now }
    return true
  }
  reg.license = { value: false, at: now, resolvedAt: now }
  return false
}

// ---- forwarding ------------------------------------------------------------

export function destinationAccepts(dest: SyslogDestination, category: string): boolean {
  if (!dest.enabled) return false
  return dest.categories.length === 0 || (dest.categories as readonly string[]).includes(category)
}

/**
 * Forward one audit row. Resolves once the lines are handed to the senders;
 * delivery itself is asynchronous. Swallows every error, logging at most one
 * warning every five minutes.
 */
export async function forwardAuditEvent(evt: SyslogAuditEvent): Promise<void> {
  try {
    const config = await loadSyslogConfig()
    const targets = config.destinations.filter(d => destinationAccepts(d, evt.category))
    if (targets.length === 0) return
    if (!(await forwardingLicensed())) return

    const ctx = formatContext()
    for (const dest of targets) {
      senderFor(dest).send(formatSyslogMessage(evt, dest, ctx))
    }
  } catch (err) {
    const reg = registry()
    const now = _impl.now()
    if (now - reg.warnedAt > WARN_EVERY_MS) {
      reg.warnedAt = now
      console.warn('[syslog] forwarding failed:', err instanceof Error ? err.message : err)
    }
  }
}

/** Build the synthetic row behind the "Send test" button. */
export function testEvent(dest: SyslogDestination, actor: { userId?: string | null; userEmail?: string | null }): SyslogAuditEvent {
  return {
    id: `test-${Date.now().toString(36)}`,
    timestamp: new Date(),
    tenantId: PROVIDER_TENANT,
    userId: actor.userId ?? null,
    userEmail: actor.userEmail ?? null,
    apiTokenId: null,
    action: 'test',
    category: 'settings',
    resourceType: 'syslog_destination',
    resourceId: dest.id,
    resourceName: dest.name,
    details: { transport: dest.transport, format: dest.format, host: dest.host, port: dest.port },
    ipAddress: null,
    userAgent: null,
    status: 'success',
    errorMessage: null,
  }
}

export async function testSyslogDestination(
  dest: SyslogDestination,
  actor: { userId?: string | null; userEmail?: string | null },
): Promise<SendOnceResult & { message: string }> {
  const message = formatSyslogMessage(testEvent(dest, actor), dest, formatContext())
  const result = await sendOnce(dest, message)
  return { ...result, message }
}

/** @internal test hook: drop caches and close every socket. */
export function _resetSyslogRegistry(): void {
  const reg = registry()
  for (const entry of reg.senders.values()) entry.sender.close()
  reg.senders.clear()
  reg.config = null
  reg.license = null
  reg.warnedAt = 0
}

export { emptySyslogStatus }

// src/lib/availability/settings.ts
//
// Availability settings: the registry retention lives in the orchestrator
// (availability.retention_days), the default target of new policies in the
// provider's `settings` row `sla.default_target`.

import { getSetting, setSetting } from '@/lib/db/settings'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from './limits'
import { isValidTarget, type Parsed } from './validate'

export const DEFAULT_TARGET_KEY = 'sla.default_target'
export const DEFAULT_TARGET = 99.9
export { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS }

/** The stored default target, 99.9 when unset or out of bounds. */
export async function getDefaultTarget(): Promise<number> {
  const stored = await getSetting<unknown>(DEFAULT_TARGET_KEY, DEFAULT_TENANT_ID)
  return isValidTarget(stored) ? stored : DEFAULT_TARGET
}

export async function setDefaultTarget(target: number): Promise<void> {
  await setSetting(DEFAULT_TARGET_KEY, DEFAULT_TENANT_ID, target)
}

export interface SettingsInput {
  retentionDays?: number
  defaultTarget?: number
  measuredConnections?: string[]
}

/** The most connections a PUT may tick, as the orchestrator bounds them. */
export const MAX_MEASURED_CONNECTIONS = 1000

/** A PUT carries one field or more, each within its bounds. */
export function parseSettingsBody(body: unknown): Parsed<SettingsInput> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'invalid_body' }
  const { retentionDays, defaultTarget, measuredConnections } = body as Record<string, unknown>
  if (retentionDays === undefined && defaultTarget === undefined && measuredConnections === undefined) return { ok: false, error: 'invalid_body' }
  const value: SettingsInput = {}
  if (retentionDays !== undefined) {
    if (typeof retentionDays !== 'number' || !Number.isInteger(retentionDays) ||
      retentionDays < RETENTION_MIN_DAYS || retentionDays > RETENTION_MAX_DAYS) {
      return { ok: false, error: 'invalid_retention' }
    }
    value.retentionDays = retentionDays
  }
  if (defaultTarget !== undefined) {
    if (!isValidTarget(defaultTarget)) return { ok: false, error: 'invalid_target' }
    value.defaultTarget = defaultTarget
  }
  if (measuredConnections !== undefined) {
    if (!Array.isArray(measuredConnections) || measuredConnections.length > MAX_MEASURED_CONNECTIONS ||
      !measuredConnections.every(id => typeof id === 'string' && id !== '' && id.length <= 128)) {
      return { ok: false, error: 'invalid_connections' }
    }
    value.measuredConnections = [...new Set(measuredConnections as string[])]
  }
  return { ok: true, value }
}

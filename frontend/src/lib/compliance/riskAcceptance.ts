// src/lib/compliance/riskAcceptance.ts
// Risk acceptance of hardening checks: a failing check an administrator decided
// to live with on one connection, with a justification and an optional expiry.

import { nanoid } from 'nanoid'

import { prisma } from '@/lib/db/prisma'
import { ALL_CHECK_IDS, type HardeningCheck } from './hardening'

export const JUSTIFICATION_MIN_LENGTH = 10
export const JUSTIFICATION_MAX_LENGTH = 1000

export interface RiskAcceptance {
  checkId: string
  justification: string
  acceptedBy: string
  acceptedAt: Date
  expiresAt: Date | null
}

/** An acceptance stands until its expiry, for ever when it has none. */
export function isAcceptanceActive(acceptance: Pick<RiskAcceptance, 'expiresAt'>, now: Date): boolean {
  return !acceptance.expiresAt || acceptance.expiresAt.getTime() > now.getTime()
}

/**
 * Turn the failing checks whose risk is accepted into 'accepted' ones. A check
 * that passes, or was skipped, is left alone: the acceptance stays in store and
 * applies again if the check fails later. An expired acceptance applies to
 * nothing, so the check reads fail again without anyone revoking it.
 */
export function applyRiskAcceptances<T extends HardeningCheck>(checks: T[], acceptances: RiskAcceptance[], now: Date = new Date()): T[] {
  const active = new Map(acceptances.filter(a => isAcceptanceActive(a, now)).map(a => [a.checkId, a]))
  if (active.size === 0) return checks

  return checks.map(check => {
    const acceptance = active.get(check.id)
    if (!acceptance || (check.status !== 'fail' && check.status !== 'warning')) return check

    return {
      ...check,
      status: 'accepted' as const,
      rawStatus: check.status,
      acceptance: {
        justification: acceptance.justification,
        acceptedBy: acceptance.acceptedBy,
        acceptedAt: acceptance.acceptedAt.toISOString(),
        expiresAt: acceptance.expiresAt ? acceptance.expiresAt.toISOString() : null,
      },
    }
  })
}

export type AcceptanceInput = { checkId: string; justification: string; expiresAt: Date | null }

/** Read and check what the acceptance form posts; a string is the refusal. */
export function parseAcceptanceInput(body: unknown, now: Date = new Date()): AcceptanceInput | string {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const checkId = typeof raw.check_id === 'string' ? raw.check_id.trim() : ''
  if (!ALL_CHECK_IDS.includes(checkId)) return 'Unknown check'

  const justification = typeof raw.justification === 'string' ? raw.justification.trim() : ''
  if (justification.length < JUSTIFICATION_MIN_LENGTH) return `A justification of at least ${JUSTIFICATION_MIN_LENGTH} characters is required`
  if (justification.length > JUSTIFICATION_MAX_LENGTH) return `The justification is limited to ${JUSTIFICATION_MAX_LENGTH} characters`

  if (raw.expires_at === undefined || raw.expires_at === null || raw.expires_at === '') return { checkId, justification, expiresAt: null }
  const expiresAt = typeof raw.expires_at === 'string' ? new Date(raw.expires_at) : null
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return 'Invalid expiry date'
  if (expiresAt.getTime() <= now.getTime()) return 'The expiry date must be in the future'

  return { checkId, justification, expiresAt }
}

function toAcceptance(row: { checkId: string; justification: string; acceptedBy: string; acceptedAt: Date; expiresAt: Date | null }): RiskAcceptance {
  return { checkId: row.checkId, justification: row.justification, acceptedBy: row.acceptedBy, acceptedAt: row.acceptedAt, expiresAt: row.expiresAt }
}

/** Every acceptance recorded for a connection, expired ones included. */
export async function listRiskAcceptances(tenantId: string, connectionId: string): Promise<RiskAcceptance[]> {
  const rows = await prisma.complianceRiskAcceptance.findMany({ where: { tenantId, connectionId }, orderBy: { acceptedAt: 'desc' } })
  return rows.map(toAcceptance)
}

/** Accept the risk of a check, or replace the acceptance it already has. */
export async function acceptRisk(tenantId: string, connectionId: string, input: AcceptanceInput, acceptedBy: string, now: Date = new Date()): Promise<RiskAcceptance> {
  const data = { justification: input.justification, acceptedBy, acceptedAt: now, expiresAt: input.expiresAt }
  const row = await prisma.complianceRiskAcceptance.upsert({
    where: { tenantId_connectionId_checkId: { tenantId, connectionId, checkId: input.checkId } },
    update: data,
    create: { id: nanoid(), tenantId, connectionId, checkId: input.checkId, ...data },
  })
  return toAcceptance(row)
}

/** Withdraw an acceptance; false when there was none. */
export async function revokeRiskAcceptance(tenantId: string, connectionId: string, checkId: string): Promise<boolean> {
  const { count } = await prisma.complianceRiskAcceptance.deleteMany({ where: { tenantId, connectionId, checkId } })
  return count > 0
}

/** Wire shape of an acceptance. */
export function serializeAcceptance(a: RiskAcceptance, now: Date = new Date()) {
  return {
    check_id: a.checkId,
    justification: a.justification,
    accepted_by: a.acceptedBy,
    accepted_at: a.acceptedAt.toISOString(),
    expires_at: a.expiresAt ? a.expiresAt.toISOString() : null,
    active: isAcceptanceActive(a, now),
  }
}

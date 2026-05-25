// src/lib/compliance/policies.ts
// CRUD for security_policies (singleton row) + password validation.
//
// The table is conceptually a singleton (id='default') even after the
// multi-tenancy refactor added a `tenant_id` column — see the original
// PRIMARY KEY on id alone. We keep the tenantId argument so the call sites
// don't need to change shape during the SQLite → Postgres refactor; the
// field is filtered on but tenant-specific rows are not currently created
// elsewhere in the codebase.
//
// The public SecurityPolicies / ALLOWED_FIELDS / API JSON shape remains in
// snake_case so existing frontend code (pages/components reading the
// response) and saved settings payloads keep working unchanged. The Prisma
// client side uses camelCase; mapping happens at the boundary of this file.

import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@prisma/client'

export interface SecurityPolicies {
  id: string
  password_min_length: number
  password_require_uppercase: boolean
  password_require_lowercase: boolean
  password_require_numbers: boolean
  password_require_special: boolean
  session_timeout_minutes: number
  session_max_concurrent: number
  login_max_failed_attempts: number
  login_lockout_duration_minutes: number
  audit_retention_days: number
  audit_auto_cleanup: boolean
  require_2fa_for_super_admin: boolean
  updated_at: string
  updated_by: string | null
}

type PrismaRow = Prisma.SecurityPolicyGetPayload<{}>

function rowToPolicies(row: PrismaRow): SecurityPolicies {
  return {
    id: row.id,
    password_min_length: row.passwordMinLength,
    password_require_uppercase: row.passwordRequireUppercase,
    password_require_lowercase: row.passwordRequireLowercase,
    password_require_numbers: row.passwordRequireNumbers,
    password_require_special: row.passwordRequireSpecial,
    session_timeout_minutes: row.sessionTimeoutMinutes,
    session_max_concurrent: row.sessionMaxConcurrent,
    login_max_failed_attempts: row.loginMaxFailedAttempts,
    login_lockout_duration_minutes: row.loginLockoutDurationMinutes,
    audit_retention_days: row.auditRetentionDays,
    audit_auto_cleanup: row.auditAutoCleanup,
    require_2fa_for_super_admin: row.require2faForSuperAdmin,
    updated_at: row.updatedAt.toISOString(),
    updated_by: row.updatedBy,
  }
}

export async function getSecurityPolicies(tenantId: string = 'default'): Promise<SecurityPolicies> {
  // Try the tenant-scoped row first; fall back to the global default if the
  // tenant hasn't customised security policies. The table is a singleton in
  // practice (id PK = 'default') so the tenant filter is a no-op today, but
  // keep it for forward compatibility with the locked multi-tenant decision.
  let row = await prisma.securityPolicy.findFirst({
    where: { id: 'default', tenantId },
  })
  if (!row && tenantId !== 'default') {
    row = await prisma.securityPolicy.findFirst({
      where: { id: 'default', tenantId: 'default' },
    })
  }
  if (!row) throw new Error('Security policies not initialized')
  return rowToPolicies(row)
}

// Snake-case (frontend / API payload) → camelCase (Prisma) field mapping.
// Centralised so a future field rename touches one place. Keep in sync with
// the Prisma model: any new column needs an entry here AND in rowToPolicies.
const SNAKE_TO_CAMEL: Record<string, keyof Prisma.SecurityPolicyUpdateInput> = {
  password_min_length: 'passwordMinLength',
  password_require_uppercase: 'passwordRequireUppercase',
  password_require_lowercase: 'passwordRequireLowercase',
  password_require_numbers: 'passwordRequireNumbers',
  password_require_special: 'passwordRequireSpecial',
  session_timeout_minutes: 'sessionTimeoutMinutes',
  session_max_concurrent: 'sessionMaxConcurrent',
  login_max_failed_attempts: 'loginMaxFailedAttempts',
  login_lockout_duration_minutes: 'loginLockoutDurationMinutes',
  audit_retention_days: 'auditRetentionDays',
  audit_auto_cleanup: 'auditAutoCleanup',
  require_2fa_for_super_admin: 'require2faForSuperAdmin',
}

/**
 * Foot-shoot guard: enabling the global 2FA-for-super_admin policy is
 * refused when the actor doesn't have 2FA on their own account. Anything
 * other than a false→true transition on this flag is a no-op.
 */
async function assertCanEnable2faPolicy(
  partial: Partial<Record<string, unknown>>,
  userId: string,
  tenantId: string,
): Promise<void> {
  if (partial.require_2fa_for_super_admin !== true) return
  const current = await prisma.securityPolicy.findFirst({
    where: { id: 'default', tenantId },
    select: { require2faForSuperAdmin: true },
  })
  if (!current || current.require2faForSuperAdmin) return
  const actor = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true },
  })
  if (!actor?.totpEnabled) {
    throw new Error('E_NEED_OWN_2FA')
  }
}

export async function updateSecurityPolicies(
  partial: Partial<Record<string, unknown>>,
  userId: string,
  tenantId: string = 'default',
): Promise<SecurityPolicies> {
  await assertCanEnable2faPolicy(partial, userId, tenantId)

  const data: Prisma.SecurityPolicyUpdateInput = {}

  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
    if (!(snake in partial)) continue
    const val = partial[snake]
    if (typeof val === 'boolean') {
      ;(data as any)[camel] = val
      continue
    }
    if (typeof val === 'number') {
      // Reject NaN / negative numeric tunables; drop the field rather than
      // surfacing a 500 from the DB constraint check downstream.
      if (Number.isNaN(val) || val < 0) continue
      ;(data as any)[camel] = val
    }
  }

  // Nothing valid in the payload → return current state untouched.
  if (Object.keys(data).length === 0) {
    return getSecurityPolicies(tenantId)
  }

  data.updatedAt = new Date()
  data.updatedBy = userId

  // updateMany so we can scope on (id, tenantId) without hitting the unique
  // constraint shape on id alone. Idempotent: if no row exists, nothing
  // happens and getSecurityPolicies below will throw "not initialized".
  await prisma.securityPolicy.updateMany({
    where: { id: 'default', tenantId },
    data,
  })

  return getSecurityPolicies(tenantId)
}

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

export async function validatePassword(
  password: string,
  policies?: SecurityPolicies,
): Promise<PasswordValidationResult> {
  const p = policies || (await getSecurityPolicies())
  const errors: string[] = []

  if (password.length < p.password_min_length) {
    errors.push(`min_length:${p.password_min_length}`)
  }
  if (p.password_require_uppercase && !/[A-Z]/.test(password)) {
    errors.push('require_uppercase')
  }
  if (p.password_require_lowercase && !/[a-z]/.test(password)) {
    errors.push('require_lowercase')
  }
  if (p.password_require_numbers && !/\d/.test(password)) {
    errors.push('require_numbers')
  }
  if (p.password_require_special && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('require_special')
  }

  return { valid: errors.length === 0, errors }
}

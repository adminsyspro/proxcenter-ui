// src/lib/compliance/policies.ts
// CRUD for security_policies (singleton row) + password validation

import { getDb } from '@/lib/db/sqlite'

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
  updated_at: string
  updated_by: string | null
}

function rowToPolicies(row: any): SecurityPolicies {
  return {
    id: row.id,
    password_min_length: row.password_min_length,
    password_require_uppercase: !!row.password_require_uppercase,
    password_require_lowercase: !!row.password_require_lowercase,
    password_require_numbers: !!row.password_require_numbers,
    password_require_special: !!row.password_require_special,
    session_timeout_minutes: row.session_timeout_minutes,
    session_max_concurrent: row.session_max_concurrent,
    login_max_failed_attempts: row.login_max_failed_attempts,
    login_lockout_duration_minutes: row.login_lockout_duration_minutes,
    audit_retention_days: row.audit_retention_days,
    audit_auto_cleanup: !!row.audit_auto_cleanup,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
  }
}

export function getSecurityPolicies(): SecurityPolicies {
  const db = getDb()
  const row = db.prepare("SELECT * FROM security_policies WHERE id = 'default'").get() as any
  if (!row) throw new Error('Security policies not initialized')
  return rowToPolicies(row)
}

const ALLOWED_FIELDS = [
  'password_min_length',
  'password_require_uppercase',
  'password_require_lowercase',
  'password_require_numbers',
  'password_require_special',
  'session_timeout_minutes',
  'session_max_concurrent',
  'login_max_failed_attempts',
  'login_lockout_duration_minutes',
  'audit_retention_days',
  'audit_auto_cleanup',
] as const

export function updateSecurityPolicies(partial: Partial<Record<string, any>>, userId: string): SecurityPolicies {
  const db = getDb()
  const sets: string[] = []
  const values: any[] = []

  for (const field of ALLOWED_FIELDS) {
    if (field in partial) {
      let val = partial[field]
      // Convert booleans to integers for SQLite
      if (typeof val === 'boolean') val = val ? 1 : 0
      // Validate numbers
      if (typeof val === 'number' && (isNaN(val) || val < 0)) continue
      sets.push(`${field} = ?`)
      values.push(val)
    }
  }

  if (sets.length === 0) {
    return getSecurityPolicies()
  }

  sets.push('updated_at = ?', 'updated_by = ?')
  values.push(new Date().toISOString(), userId)

  db.prepare(`UPDATE security_policies SET ${sets.join(', ')} WHERE id = 'default'`).run(...values)

  return getSecurityPolicies()
}

export interface PasswordValidationResult {
  valid: boolean
  errors: string[]
}

export function validatePassword(password: string, policies?: SecurityPolicies): PasswordValidationResult {
  const p = policies || getSecurityPolicies()
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

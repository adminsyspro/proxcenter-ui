// src/lib/compliance/profiles.ts
// CRUD operations for compliance profiles

import { getDb } from '@/lib/db/sqlite'

export interface ComplianceProfile {
  id: string
  name: string
  description: string | null
  framework_id: string | null
  is_active: number
  connection_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ComplianceProfileCheck {
  id: string
  profile_id: string
  check_id: string
  enabled: number
  weight: number
  control_ref: string | null
  category: string | null
}

export function listProfiles(tenantId: string, connectionId?: string): ComplianceProfile[] {
  const db = getDb()
  if (connectionId) {
    return db.prepare(
      'SELECT * FROM compliance_profiles WHERE tenant_id = ? AND (connection_id = ? OR connection_id IS NULL) ORDER BY created_at DESC'
    ).all(tenantId, connectionId) as ComplianceProfile[]
  }
  return db.prepare('SELECT * FROM compliance_profiles WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId) as ComplianceProfile[]
}

export function getProfile(id: string, tenantId: string): ComplianceProfile | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM compliance_profiles WHERE id = ? AND tenant_id = ?').get(id, tenantId) as ComplianceProfile | undefined
}

export function getProfileChecks(profileId: string, tenantId: string): ComplianceProfileCheck[] {
  const db = getDb()
  return db.prepare('SELECT * FROM compliance_profile_checks WHERE profile_id = ? AND tenant_id = ?').all(profileId, tenantId) as ComplianceProfileCheck[]
}

export function createProfile(data: {
  name: string
  description?: string
  connection_id?: string
  created_by?: string
  tenant_id: string
}): ComplianceProfile {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO compliance_profiles (id, name, description, framework_id, is_active, connection_id, created_by, created_at, updated_at, tenant_id)
    VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.description || null, data.connection_id || null, data.created_by || null, now, now, data.tenant_id)

  return getProfile(id, data.tenant_id)!
}

export function updateProfile(id: string, data: {
  name?: string
  description?: string
}, tenantId: string): ComplianceProfile | undefined {
  const db = getDb()
  const now = new Date().toISOString()
  const fields: string[] = ['updated_at = ?']
  const values: any[] = [now]

  if (data.name !== undefined) {
    fields.push('name = ?')
    values.push(data.name)
  }
  if (data.description !== undefined) {
    fields.push('description = ?')
    values.push(data.description)
  }

  values.push(id, tenantId)
  db.prepare(`UPDATE compliance_profiles SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values)
  return getProfile(id, tenantId)
}

export function updateProfileChecks(
  profileId: string,
  checks: Array<{
    check_id: string
    enabled: boolean
    weight: number
    control_ref?: string
    category?: string
  }>,
  tenantId: string
): void {
  const db = getDb()

  // Delete existing checks and re-insert
  db.prepare('DELETE FROM compliance_profile_checks WHERE profile_id = ? AND tenant_id = ?').run(profileId, tenantId)

  const insert = db.prepare(`
    INSERT INTO compliance_profile_checks (id, profile_id, check_id, enabled, weight, control_ref, category, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const check of checks) {
    insert.run(
      crypto.randomUUID(),
      profileId,
      check.check_id,
      check.enabled ? 1 : 0,
      check.weight,
      check.control_ref || null,
      check.category || null,
      tenantId
    )
  }

  // Update profile timestamp
  db.prepare('UPDATE compliance_profiles SET updated_at = ? WHERE id = ? AND tenant_id = ?').run(new Date().toISOString(), profileId, tenantId)
}

export function deleteProfile(id: string, tenantId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM compliance_profiles WHERE id = ? AND tenant_id = ?').run(id, tenantId)
}

export function setActiveProfile(profileId: string, connectionId: string | undefined, tenantId: string): void {
  const db = getDb()

  // Deactivate all profiles (optionally scoped to a connection), always scoped by tenant
  if (connectionId) {
    db.prepare('UPDATE compliance_profiles SET is_active = 0 WHERE tenant_id = ? AND (connection_id = ? OR connection_id IS NULL)').run(tenantId, connectionId)
  } else {
    db.prepare('UPDATE compliance_profiles SET is_active = 0 WHERE tenant_id = ?').run(tenantId)
  }

  // Activate the selected one
  db.prepare('UPDATE compliance_profiles SET is_active = 1 WHERE id = ? AND tenant_id = ?').run(profileId, tenantId)
}

export function deactivateProfiles(connectionId: string | undefined, tenantId: string): void {
  const db = getDb()
  if (connectionId) {
    db.prepare('UPDATE compliance_profiles SET is_active = 0 WHERE tenant_id = ? AND (connection_id = ? OR connection_id IS NULL)').run(tenantId, connectionId)
  } else {
    db.prepare('UPDATE compliance_profiles SET is_active = 0 WHERE tenant_id = ?').run(tenantId)
  }
}

export function getActiveProfile(connectionId: string | undefined, tenantId: string): (ComplianceProfile & { checks: ComplianceProfileCheck[] }) | null {
  const db = getDb()
  let profile: ComplianceProfile | undefined

  if (connectionId) {
    profile = db.prepare(
      'SELECT * FROM compliance_profiles WHERE is_active = 1 AND tenant_id = ? AND (connection_id = ? OR connection_id IS NULL) LIMIT 1'
    ).get(tenantId, connectionId) as ComplianceProfile | undefined
  } else {
    profile = db.prepare('SELECT * FROM compliance_profiles WHERE is_active = 1 AND tenant_id = ? LIMIT 1').get(tenantId) as ComplianceProfile | undefined
  }

  if (!profile) return null

  const checks = getProfileChecks(profile.id, tenantId)
  return { ...profile, checks }
}

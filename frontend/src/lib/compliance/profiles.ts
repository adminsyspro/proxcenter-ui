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

export function listProfiles(connectionId?: string): ComplianceProfile[] {
  const db = getDb()
  if (connectionId) {
    return db.prepare(
      'SELECT * FROM compliance_profiles WHERE connection_id = ? OR connection_id IS NULL ORDER BY created_at DESC'
    ).all(connectionId) as ComplianceProfile[]
  }
  return db.prepare('SELECT * FROM compliance_profiles ORDER BY created_at DESC').all() as ComplianceProfile[]
}

export function getProfile(id: string): ComplianceProfile | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM compliance_profiles WHERE id = ?').get(id) as ComplianceProfile | undefined
}

export function getProfileChecks(profileId: string): ComplianceProfileCheck[] {
  const db = getDb()
  return db.prepare('SELECT * FROM compliance_profile_checks WHERE profile_id = ?').all(profileId) as ComplianceProfileCheck[]
}

export function createProfile(data: {
  name: string
  description?: string
  connection_id?: string
  created_by?: string
}): ComplianceProfile {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO compliance_profiles (id, name, description, framework_id, is_active, connection_id, created_by, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?)
  `).run(id, data.name, data.description || null, data.connection_id || null, data.created_by || null, now, now)

  return getProfile(id)!
}

export function updateProfile(id: string, data: {
  name?: string
  description?: string
}): ComplianceProfile | undefined {
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

  values.push(id)
  db.prepare(`UPDATE compliance_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getProfile(id)
}

export function updateProfileChecks(
  profileId: string,
  checks: Array<{
    check_id: string
    enabled: boolean
    weight: number
    control_ref?: string
    category?: string
  }>
): void {
  const db = getDb()

  // Delete existing checks and re-insert
  db.prepare('DELETE FROM compliance_profile_checks WHERE profile_id = ?').run(profileId)

  const insert = db.prepare(`
    INSERT INTO compliance_profile_checks (id, profile_id, check_id, enabled, weight, control_ref, category)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  for (const check of checks) {
    insert.run(
      crypto.randomUUID(),
      profileId,
      check.check_id,
      check.enabled ? 1 : 0,
      check.weight,
      check.control_ref || null,
      check.category || null
    )
  }

  // Update profile timestamp
  db.prepare('UPDATE compliance_profiles SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), profileId)
}

export function deleteProfile(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM compliance_profiles WHERE id = ?').run(id)
}

export function setActiveProfile(profileId: string, connectionId?: string): void {
  const db = getDb()

  // Deactivate all profiles (optionally scoped to a connection)
  if (connectionId) {
    db.prepare('UPDATE compliance_profiles SET is_active = 0 WHERE connection_id = ? OR connection_id IS NULL').run(connectionId)
  } else {
    db.prepare('UPDATE compliance_profiles SET is_active = 0').run()
  }

  // Activate the selected one
  db.prepare('UPDATE compliance_profiles SET is_active = 1 WHERE id = ?').run(profileId)
}

export function deactivateProfiles(connectionId?: string): void {
  const db = getDb()
  if (connectionId) {
    db.prepare('UPDATE compliance_profiles SET is_active = 0 WHERE connection_id = ? OR connection_id IS NULL').run(connectionId)
  } else {
    db.prepare('UPDATE compliance_profiles SET is_active = 0').run()
  }
}

export function getActiveProfile(connectionId?: string): (ComplianceProfile & { checks: ComplianceProfileCheck[] }) | null {
  const db = getDb()
  let profile: ComplianceProfile | undefined

  if (connectionId) {
    profile = db.prepare(
      'SELECT * FROM compliance_profiles WHERE is_active = 1 AND (connection_id = ? OR connection_id IS NULL) LIMIT 1'
    ).get(connectionId) as ComplianceProfile | undefined
  } else {
    profile = db.prepare('SELECT * FROM compliance_profiles WHERE is_active = 1 LIMIT 1').get() as ComplianceProfile | undefined
  }

  if (!profile) return null

  const checks = getProfileChecks(profile.id)
  return { ...profile, checks }
}

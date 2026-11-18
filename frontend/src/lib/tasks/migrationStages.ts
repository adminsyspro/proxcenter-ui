// src/lib/tasks/migrationStages.ts
//
// Where a guest migration stands, read from its Proxmox task log (#1392).
//
// Proxmox reports no phase for a migration task, only a text log. The stages
// below are recognised from the sentences qemu-server and pve-container write
// (checked against real qmigrate / vzmigrate logs: live, offline, local disks,
// ZFS and RBD cross-cluster, restart-mode containers, aborted runs). Those
// sentences are not an API: when none is recognised the answer is null and the
// viewer shows the log alone, a missing timeline being better than a wrong one.

export type MigrationStageId = 'prepare' | 'disks' | 'memory' | 'finalize'
export type MigrationStageState = 'done' | 'active' | 'error' | 'pending'
export type MigrationTaskState = 'running' | 'done' | 'failed'

export interface MigrationStage {
  id: MigrationStageId
  state: MigrationStageState
}

const ORDER: MigrationStageId[] = ['prepare', 'disks', 'memory', 'finalize']

/** Task types whose log is a guest migration. */
export const MIGRATION_TASK_TYPES = new Set(['qmigrate', 'vzmigrate'])

// The stage a line proves has been REACHED.
const REACHED: Array<[MigrationStageId, RegExp]> = [
  ['prepare', /starting migration of (vm|ct) \d+|shutdown ct \d+/],
  ['disks', /copying local disk images|starting storage migration|drive mirror is starting|^mirror-\w+:|start migration to nbd|allocating volume for drive|sending command "(query-)?disk-import"|disk-import: |(exporting|importing) image: |full send of |^time\s+sent\s+snapshot/],
  ['memory', /starting online\/live migration|start migrate command to|migration active, transferred/],
  ['finalize', /migration status: completed|migration completed, transferred|start final cleanup|start container on target node|sending command "(config|unlock|quit)"|migration finished/],
]

// A line announcing that a stage WILL run, before it starts: lets the timeline
// show the step as pending instead of making it appear halfway through.
const EXPECTED: Array<[MigrationStageId, RegExp]> = [
  ['disks', /found (local|generated) (disk|volume) /],
  ['memory', /starting vm \d+ on remote node|start remote tunnel|sending command "start" to remote/],
]

const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /

/**
 * The stages of a migration and how far it got. `logs` are the task log lines,
 * with or without their leading timestamp. Null when nothing is recognised.
 */
export function migrationStages(logs: readonly string[], task: MigrationTaskState): MigrationStage[] | null {
  const reached = new Set<MigrationStageId>()
  const expected = new Set<MigrationStageId>()

  for (const raw of logs) {
    const line = String(raw ?? '').replace(TIMESTAMP, '').trim().toLowerCase()

    if (!line) continue
    for (const [id, re] of REACHED) if (re.test(line)) reached.add(id)
    for (const [id, re] of EXPECTED) if (re.test(line)) expected.add(id)
  }

  if (reached.size === 0) return null

  // Preparation and finalisation always exist; disk copy and memory transfer
  // only when the log shows or announces them (a stopped guest on shared
  // storage has neither).
  const shown = ORDER.filter(id => id === 'prepare' || id === 'finalize' || reached.has(id) || expected.has(id))
  const current = Math.max(...shown.map((id, i) => (reached.has(id) ? i : -1)), 0)

  return shown.map((id, i) => {
    if (task === 'done') return { id, state: 'done' as const }
    if (i < current) return { id, state: 'done' as const }
    if (i > current) return { id, state: 'pending' as const }

    return { id, state: task === 'failed' ? ('error' as const) : ('active' as const) }
  })
}

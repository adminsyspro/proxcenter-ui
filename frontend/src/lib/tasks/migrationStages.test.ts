import { describe, expect, it } from 'vitest'

import { migrationStages } from './migrationStages'

// Excerpts of real task logs taken on the lab clusters (PVE 9).
const LIVE_SHARED = [
  "2026-11-18 06:39:19 conntrack state migration not supported or disabled, active connections might get dropped",
  "2026-11-18 06:39:19 starting migration of VM 116 to node 'pve2' (10.42.0.102)",
  "2026-11-18 06:39:19 starting VM 116 on remote node 'pve2'",
  "2026-11-18 06:39:21 start remote tunnel",
  "2026-11-18 06:39:22 ssh tunnel ver 1",
  "2026-11-18 06:39:22 starting online/live migration on unix:/run/qemu-server/116.migrate",
  "2026-11-18 06:39:23 migration active, transferred 139.7 MiB of 2.0 GiB VM-state, 160.3 MiB/s",
  "2026-11-18 06:39:27 migration completed, transferred 794.4 MiB VM-state",
  "2026-11-18 06:39:27 migration status: completed",
  "2026-11-18 06:39:30 migration finished successfully (duration 00:00:11)",
  "TASK OK",
]
const LIVE_LOCAL_DISK = [
  "starting migration of VM 120 to node 'pve2' (10.42.0.102)",
  "found local disk 'ZFS-Pool:vm-120-disk-0' (attached)",
  "starting VM 120 on remote node 'pve2'",
  "start remote tunnel",
  "starting storage migration",
  "scsi0: start migration to nbd:unix:/run/qemu-server/120_nbd.migrate:exportname=drive-scsi0",
  "drive mirror is starting for drive-scsi0",
  "mirror-scsi0: transferred 1.2 GiB of 8.0 GiB (15.00%) in 3s",
]
const CONTAINER_RESTART = [
  "2026-11-18 07:08:15 shutdown CT 101",
  "2026-11-18 07:08:17 starting migration of CT 101 to node 'pve2' (10.42.0.102)",
  "2026-11-18 07:08:17 volume 'CephStoragePool:vm-101-disk-0' is on shared storage 'CephStoragePool'",
  "2026-11-18 07:08:17 start final cleanup",
  "2026-11-18 07:08:18 start container on target node",
  "2026-11-18 07:08:21 migration finished successfully (duration 00:00:06)",
  "TASK OK",
]
const CROSS_OFFLINE_ZFS = [
  "remote: started tunnel worker 'UPID:pve2-dr:002D971A:0920318A:6AFD3F65:qmtunnel:101:root@pam!root:'",
  "tunnel: -> sending command \"version\" to remote",
  "2026-11-18 07:02:13 starting migration of VM 7012 to node 'pve2-dr' (10.42.0.112)",
  "2026-11-18 07:02:13 found local disk 'ZFS-Pool:vm-7012-disk-0' (attached)",
  "2026-11-18 07:02:13 copying local disk images",
  "tunnel: -> sending command \"disk-import\" to remote",
  "full send of ZFS-Pool/vm-7012-disk-0@__migration__ estimated size is 1.2G",
]
const ABORTED_SCAN = [
  "starting migration of VM 104 to node 'pve2' (10.42.0.102)",
  "found local disk 'local:iso/debian-13.0-amd64-netinst.iso' (attached)",
  "can't migrate local disk 'local:iso/debian-13.0-amd64-netinst.iso': can't live migrate attached local disks without with-local-disks option",
  "ERROR: Problem found while scanning volumes - can't migrate VM - check log",
  "aborting phase 1 - cleanup resources",
  "ERROR: migration aborted (duration 00:00:01): Problem found while scanning volumes - can't migrate VM - check log",
  "TASK ERROR: migration aborted",
]

const states = (logs: string[], task: Parameters<typeof migrationStages>[1]) =>
  migrationStages(logs, task)?.map(s => `${s.id}:${s.state}`)

describe('migrationStages', () => {
  it('follows a live migration on shared storage: no disk step', () => {
    expect(states(LIVE_SHARED.slice(0, 3), 'running')).toEqual(['prepare:active', 'memory:pending', 'finalize:pending'])
    expect(states(LIVE_SHARED.slice(0, 7), 'running')).toEqual(['prepare:done', 'memory:active', 'finalize:pending'])
    expect(states(LIVE_SHARED.slice(0, 9), 'running')).toEqual(['prepare:done', 'memory:done', 'finalize:active'])
    expect(states(LIVE_SHARED, 'done')).toEqual(['prepare:done', 'memory:done', 'finalize:done'])
  })

  it('shows the disk copy before the memory transfer for a live migration with local disks', () => {
    expect(states(LIVE_LOCAL_DISK.slice(0, 4), 'running')).toEqual(['prepare:active', 'disks:pending', 'memory:pending', 'finalize:pending'])
    expect(states(LIVE_LOCAL_DISK, 'running')).toEqual(['prepare:done', 'disks:active', 'memory:pending', 'finalize:pending'])
  })

  it('keeps a restart-mode container to preparation and finalisation', () => {
    expect(states(CONTAINER_RESTART.slice(0, 1), 'running')).toEqual(['prepare:active', 'finalize:pending'])
    expect(states(CONTAINER_RESTART, 'done')).toEqual(['prepare:done', 'finalize:done'])
  })

  it('reads an offline cross-cluster migration: disks, no memory', () => {
    expect(states(CROSS_OFFLINE_ZFS, 'running')).toEqual(['prepare:done', 'disks:active', 'finalize:pending'])
  })

  it('marks the stage a failed migration stopped at', () => {
    expect(states(ABORTED_SCAN, 'failed')).toEqual(['prepare:error', 'disks:pending', 'finalize:pending'])
    expect(states(LIVE_SHARED.slice(0, 7), 'failed')).toEqual(['prepare:done', 'memory:error', 'finalize:pending'])
  })

  it('answers null when no sentence is recognised, so no timeline is drawn', () => {
    expect(migrationStages([], 'running')).toBeNull()
    expect(migrationStages(['trying to acquire lock...', ' OK', 'TASK OK'], 'done')).toBeNull()
  })

  it('still places a migration whose first lines were truncated', () => {
    expect(states(LIVE_SHARED.slice(6, 8), 'running')).toEqual(['prepare:done', 'memory:done', 'finalize:active'])
  })
})

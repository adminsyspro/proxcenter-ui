import { describe, expect, it } from 'vitest'

import { extractTaskFailureReason, TASK_FAILURE_REASON_MAX } from './taskFailureReason'

const log = (...lines: string[]) => lines.map((t, i) => ({ n: i + 1, t }))

describe('extractTaskFailureReason', () => {
  it('reads the reason a qemu migration was aborted with, not "migration aborted"', () => {
    const reason = extractTaskFailureReason(log(
      "2026-09-11 10:00:00 starting migration of VM 100 to node 'pve2' (10.42.0.102)",
      "2026-09-11 10:00:00 found local disk 'local-lvm:vm-100-disk-0' (attached)",
      "2026-09-11 10:00:00 ERROR: Problem found while scanning volumes - can't migrate local cdrom 'local:iso/debian.iso'",
      '2026-09-11 10:00:00 aborting phase 1 - cleanup resources',
      "2026-09-11 10:00:01 ERROR: migration aborted (duration 00:00:01): Problem found while scanning volumes - can't migrate local cdrom 'local:iso/debian.iso'",
      'TASK ERROR: migration aborted',
    ))

    expect(reason).toBe("Problem found while scanning volumes - can't migrate local cdrom 'local:iso/debian.iso'")
  })

  it('keeps the online migrate failure of a live migration', () => {
    const reason = extractTaskFailureReason(log(
      "2026-09-11 10:00:00 starting migration of VM 101 to node 'pve3' (10.42.0.103)",
      '2026-09-11 10:00:02 starting online/live migration on unix:/run/qemu-server/101.migrate',
      '2026-09-11 10:00:03 migration status error: failed - Unable to write to socket: Broken pipe',
      "2026-09-11 10:00:03 ERROR: online migrate failure - VM 101 qmp command 'migrate' failed - aborting",
      '2026-09-11 10:00:03 aborting phase 2 - cleanup resources',
      '2026-09-11 10:00:04 migrate_cancel',
      '2026-09-11 10:00:05 ERROR: migration finished with problems (duration 00:00:05)',
      'TASK ERROR: migration problems',
    ))

    expect(reason).toBe("online migrate failure - VM 101 qmp command 'migrate' failed - aborting")
  })

  it('takes a specific TASK ERROR line when the task fails before logging anything else', () => {
    expect(extractTaskFailureReason(log('TASK ERROR: CT is locked (backup)'))).toBe('CT is locked (backup)')
    expect(extractTaskFailureReason(log(
      "TASK ERROR: can't migrate VM which uses local devices: hostpci0",
    ))).toBe("can't migrate VM which uses local devices: hostpci0")
  })

  it('reads the reason an lxc migration was aborted with', () => {
    const reason = extractTaskFailureReason(log(
      '2026-09-11 10:00:00 shutdown CT 200',
      "2026-09-11 10:00:04 starting migration of CT 200 to node 'pve2' (10.42.0.102)",
      "2026-09-11 10:00:04 ERROR: storage 'local-zfs' is not available on node 'pve2'",
      '2026-09-11 10:00:04 aborting phase 1 - cleanup resources',
      "2026-09-11 10:00:04 ERROR: found stale volume copy 'local-zfs:subvol-200-disk-0' on node 'pve2'",
      "2026-09-11 10:00:04 start final cleanup",
      "2026-09-11 10:00:04 ERROR: migration aborted (duration 00:00:01): storage 'local-zfs' is not available on node 'pve2'",
      'TASK ERROR: migration aborted',
    ))

    expect(reason).toBe("storage 'local-zfs' is not available on node 'pve2'")
  })

  it('falls back to an untagged error line, skipping progress and counters', () => {
    const reason = extractTaskFailureReason(log(
      'INFO: starting new backup job: vzdump 100 --storage pbs',
      'INFO:  45% (9.0 GiB of 20.0 GiB) in 30s, read: 300.0 MiB/s, write: 0 B/s, errors: 0',
      'INFO: 0 errors so far',
      "command 'zfs snapshot rpool/data/vm-100-disk-0@vzdump' failed: exit code 1",
      'TASK ERROR: job errors',
    ))

    expect(reason).toBe("command 'zfs snapshot rpool/data/vm-100-disk-0@vzdump' failed: exit code 1")
  })

  it('returns the generic message when the log has nothing better', () => {
    expect(extractTaskFailureReason(log('TASK ERROR: migration aborted'))).toBe('migration aborted')
  })

  it('returns null for an empty log or one without any error', () => {
    expect(extractTaskFailureReason([])).toBeNull()
    expect(extractTaskFailureReason(log('starting', 'TASK OK'))).toBeNull()
    expect(extractTaskFailureReason([null, undefined, { t: '' }])).toBeNull()
  })

  it('caps a very long reason', () => {
    const reason = extractTaskFailureReason(log(`TASK ERROR: ${'x'.repeat(1000)}`))

    expect(reason).toHaveLength(TASK_FAILURE_REASON_MAX)
    expect(reason!.endsWith('…')).toBe(true)
  })
})

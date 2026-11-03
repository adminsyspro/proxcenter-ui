import { describe, it, expect } from 'vitest'

import {
  isMoveTaskType,
  isTaskLogEnd,
  parseByteSize,
  parseDurationSec,
  parseMoveProgress,
  upidStartSec,
} from './moveProgress'

const GIB = 1024 ** 3
const MIB = 1024 ** 2

describe('isMoveTaskType', () => {
  it('knows the VM disk move and the container volume move', () => {
    expect(isMoveTaskType('qmmove')).toBe(true)
    expect(isMoveTaskType('move_volume')).toBe(true)
    expect(isMoveTaskType('vzmove')).toBe(true)
  })

  it('leaves every other task type out', () => {
    expect(isMoveTaskType('qmigrate')).toBe(false)
    expect(isMoveTaskType('vzdump')).toBe(false)
    expect(isMoveTaskType('')).toBe(false)
    expect(isMoveTaskType(null)).toBe(false)
    expect(isMoveTaskType(undefined)).toBe(false)
  })
})

describe('parseByteSize', () => {
  it('reads the binary units PVE renders', () => {
    expect(parseByteSize('512.0', 'MiB')).toBe(512 * MIB)
    expect(parseByteSize('1.0', 'GiB')).toBe(GIB)
    expect(parseByteSize('2', 'TiB')).toBe(2 * 1024 ** 4)
    expect(parseByteSize('100.0', 'KiB')).toBe(100 * 1024)
    expect(parseByteSize('0.0', 'B')).toBe(0)
  })

  it('reads the short and decimal-looking spellings as binary', () => {
    expect(parseByteSize('1', 'G')).toBe(GIB)
    expect(parseByteSize('1', 'MB')).toBe(MIB)
    expect(parseByteSize('3', 'k')).toBe(3 * 1024)
    expect(parseByteSize('1', 'PiB')).toBe(1024 ** 5)
  })

  it('returns null for an unknown unit or a non number', () => {
    expect(parseByteSize('1', 'parsecs')).toBeNull()
    expect(parseByteSize('abc', 'GiB')).toBeNull()
  })
})

describe('parseDurationSec', () => {
  it('reads plain seconds and rendered durations', () => {
    expect(parseDurationSec('2s')).toBe(2)
    expect(parseDurationSec('1m 5s')).toBe(65)
    expect(parseDurationSec('1h 2m 3s')).toBe(3723)
  })

  it('returns null on anything else', () => {
    expect(parseDurationSec('')).toBeNull()
    expect(parseDurationSec('soon')).toBeNull()
  })
})

describe('upidStartSec', () => {
  it('reads the hex start time of a UPID', () => {
    expect(upidStartSec('UPID:pve1:001C9B56:09EE7859:6AB525DA:qmmove:100:root@pam:')).toBe(0x6ab525da)
  })

  it('returns null on a malformed UPID', () => {
    expect(upidStartSec('not-a-upid')).toBeNull()
    expect(upidStartSec('UPID:pve1:1:2:zz:qmmove:100:root@pam:')).toBeNull()
  })
})

describe('isTaskLogEnd', () => {
  it('spots the closing line of a finished task', () => {
    expect(isTaskLogEnd(['mirror-scsi0: Completed successfully.', 'TASK OK'])).toBe(true)
    expect(isTaskLogEnd(['TASK ERROR: storage migration failed: cannot move TPM state while VM is running'])).toBe(true)
    expect(isTaskLogEnd(['TASK WARNINGS: 1'])).toBe(true)
  })

  it('is false while the task still writes progress', () => {
    expect(isTaskLogEnd(['mirror-scsi0: transferred 512.0 MiB of 1.0 GiB (50.00%) in 2s'])).toBe(false)
    expect(isTaskLogEnd([])).toBe(false)
  })
})

describe('parseMoveProgress', () => {
  it('online move (drive mirror): last line wins, throughput from its own duration', () => {
    const lines = [
      'create full clone of drive scsi0 (ceph-vm:vm-100-disk-0)',
      'drive mirror is starting for drive-scsi0',
      'mirror-scsi0: transferred 128.0 MiB of 1.0 GiB (12.50%) in 1s',
      'mirror-scsi0: transferred 512.0 MiB of 1.0 GiB (50.00%) in 2s',
    ]
    const p = parseMoveProgress(lines)
    expect(p).toEqual({
      percent: 50,
      doneBytes: 512 * MIB,
      totalBytes: GIB,
      bytesPerSec: 256 * MIB,
      etaSec: 2,
    })
  })

  it('online move once the mirror is ready: 100 % and no time left', () => {
    const lines = [
      'mirror-scsi0: transferred 1.0 GiB of 1.0 GiB (100.00%) in 4s, ready',
      "all 'mirror' jobs are ready",
      'mirror-scsi0: Completing block job...',
    ]
    const p = parseMoveProgress(lines)
    expect(p?.percent).toBe(100)
    expect(p?.etaSec).toBe(0)
  })

  it('offline copy (qemu-img convert): throughput from the elapsed time of the task', () => {
    const lines = [
      'create full clone of drive scsi0 (local-zfs:vm-100-disk-0)',
      'transferred 0.0 B of 32.0 GiB (0.00%)',
      'transferred 8.0 GiB of 32.0 GiB (25.00%)',
    ]
    const p = parseMoveProgress(lines, { elapsedSec: 80 })
    expect(p?.percent).toBe(25)
    expect(p?.doneBytes).toBe(8 * GIB)
    expect(p?.totalBytes).toBe(32 * GIB)
    expect(p?.bytesPerSec).toBe((8 * GIB) / 80)
    expect(p?.etaSec).toBe(240)
  })

  it('offline copy without an elapsed time: bytes known, no throughput nor ETA', () => {
    const p = parseMoveProgress(['transferred 8.0 GiB of 32.0 GiB (25.00%)'])
    expect(p?.percent).toBe(25)
    expect(p?.bytesPerSec).toBeNull()
    expect(p?.etaSec).toBeNull()
  })

  it('nothing transferred yet: no throughput', () => {
    const p = parseMoveProgress(['transferred 0.0 B of 32.0 GiB (0.00%)'], { elapsedSec: 5 })
    expect(p?.percent).toBe(0)
    expect(p?.bytesPerSec).toBeNull()
    expect(p?.etaSec).toBeNull()
  })

  it('a line carrying only a percentage still moves the bar', () => {
    const p = parseMoveProgress(['  1,234,567,890  45%  112.34MB/s    0:00:10'])
    expect(p).toEqual({ percent: 45, doneBytes: null, totalBytes: null, bytesPerSec: null, etaSec: null })
  })

  it('clamps an out-of-range percentage', () => {
    expect(parseMoveProgress(['transferred 1.0 GiB of 1.0 GiB (100.01%) in 3s'])?.percent).toBe(100)
  })

  it('returns null when no line reports progress', () => {
    expect(parseMoveProgress([])).toBeNull()
    expect(parseMoveProgress(['create full clone of drive scsi0 (ceph-vm:vm-100-disk-0)', 'no content'])).toBeNull()
  })

  it('ignores a transfer line with an unknown unit and falls back to its percentage', () => {
    const p = parseMoveProgress(['transferred 1.0 XB of 2.0 XB (50.00%)'])
    expect(p?.percent).toBe(50)
    expect(p?.doneBytes).toBeNull()
  })
})

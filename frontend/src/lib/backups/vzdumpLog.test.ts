import { describe, it, expect } from 'vitest'

import localLxc from './__fixtures__/vzdump/local-lxc.json'
import localQemu from './__fixtures__/vzdump/local-qemu.json'
import interrupted from './__fixtures__/vzdump/local-qemu-interrupted.json'
import pbsMulti from './__fixtures__/vzdump/pbs-multi-lxc-qemu.json'
import pbsQemu from './__fixtures__/vzdump/pbs-qemu-running.json'
import notFound from './__fixtures__/vzdump/scheduled-guest-not-found.json'
import pruneFailed from './__fixtures__/vzdump/scheduled-pbs-prune-failed.json'
import { parseSize, parseVzdumpLog, rawLines, type TaskLogLine } from './vzdumpLog'

const MiB = 1024 ** 2
const GiB = 1024 ** 3

describe('parseSize', () => {
  it('reads binary and PVE short units', () => {
    expect(parseSize('1.00', 'GiB')).toBe(GiB)
    expect(parseSize('1003', 'MB')).toBe(1003 * MiB)
    expect(parseSize('3', 'bogus')).toBeNull()
  })
})

describe('parseVzdumpLog — multi-guest PBS task (pve1, 2026-09-24)', () => {
  // UPID start 0x6AB51CA9 = 1790254249 = 2026-09-24T12:50:49Z; the node logs CEST.
  const log = parseVzdumpLog(pbsMulti as TaskLogLine[], { taskStart: 1790254249 })

  it('keeps the command line and splits one section per guest, in log order', () => {
    expect(log.commandLine).toContain('vzdump 101 9911 9882')
    expect(log.guests.map(g => [g.vmid, g.type])).toEqual([[101, 'lxc'], [9882, 'qemu'], [9911, 'lxc']])
    expect(log.guests.every(g => g.status === 'ok')).toBe(true)
  })

  it('converts the node-local times with the offset derived from the task start', () => {
    const ct = log.guests[0]
    expect(ct.start).toBe(1790254249)
    expect(ct.end).toBe(1790254263)
    expect(ct.durationSec).toBe(14)
  })

  it('reads the LXC→PBS metrics from the pxar lines and the namespace', () => {
    const ct = log.guests[0]
    expect(ct.name).toBe('debian-test')
    expect(ct.archive).toBe('ct/101/2026-09-24T12:50:49Z')
    expect(ct.namespace).toBe('tenant-msp/vdc-msp-pve-prod')
    expect(ct.transferredBytes).toBe(Math.round(649.395 * MiB))
    expect(ct.reusedBytes).toBe(Math.round(7.511 * MiB))
    expect(ct.reusedPercent).toBe(1.2)
  })

  it('reads the QEMU→PBS metrics', () => {
    const vm = log.guests[1]
    expect(vm.name).toBe('t-ccm-882')
    expect(vm.transferredBytes).toBe(GiB)
    expect(vm.reusedBytes).toBe(GiB)
    expect(vm.reusedPercent).toBe(100)
    expect(vm.zeroBytes).toBe(GiB)
  })

  it('puts lines outside guests in the job section, lines without INFO: in their guest', () => {
    expect(log.jobLines.map(l => l.t)).toContain('TASK OK')
    expect(log.guests[0].lines.some(l => l.t === 'freeze guest filesystem')).toBe(true)
    expect(log.taskError).toBeNull()
  })

  it('rawLines gives every line back in order', () => {
    const all = rawLines(log)
    expect(all).toHaveLength(pbsMulti.length)
    expect(all.map(l => l.n)).toEqual([...all.map(l => l.n)].sort((a, b) => a - b))
  })
})

describe('parseVzdumpLog — local archives', () => {
  it('reads Total bytes written and the archive size of a local LXC backup', () => {
    const ct = parseVzdumpLog(localLxc as TaskLogLine[]).guests[0]
    expect(ct.transferredBytes).toBe(674385920)
    expect(ct.archiveSizeBytes).toBe(193 * MiB)
    expect(ct.archive).toBe('/var/lib/vz/dump/vzdump-lxc-9911-2026_09_24-14_51_18.tar.zst')
    expect(ct.reusedBytes).toBeNull()
  })

  it('reads a local QEMU backup and its duration', () => {
    const vm = parseVzdumpLog(localQemu as TaskLogLine[]).guests[0]
    expect(vm.status).toBe('ok')
    expect(vm.durationSec).toBe(148)
    expect(vm.transferredBytes).toBe(20 * GiB)
    expect(vm.archiveSizeBytes).toBe(1003 * MiB)
  })

  it('keeps the percent PBS printed when there is a single reused line', () => {
    expect(parseVzdumpLog(pbsQemu as TaskLogLine[]).guests[0].reusedPercent).toBe(94)
  })

  it('leaves times null without a task start (no offset to apply)', () => {
    expect(parseVzdumpLog(localQemu as TaskLogLine[]).guests[0].start).toBeNull()
  })
})

describe('parseVzdumpLog — derived status', () => {
  it("reports the reporter's case: backup written, prune refused → post_step_failed / prune", () => {
    const log = parseVzdumpLog(pruneFailed as TaskLogLine[], { taskStart: 1790256602 })
    const vm = log.guests[0]
    expect(vm.status).toBe('post_step_failed')
    expect(vm.step).toBe('prune')
    expect(vm.reason).toBe('error pruning backups - check log')
    expect(vm.errors[0]).toContain('missing Datastore.Modify|Datastore.Prune')
    expect(vm.transferredBytes).toBe(GiB)
    expect(vm.end).toBe(1790256604)
    expect(log.taskError).toBe('job errors')
  })

  it('an interrupted backup before any data line is failed', () => {
    const vm = parseVzdumpLog(interrupted as TaskLogLine[]).guests[0]
    expect(vm.status).toBe('failed')
    expect(vm.reason).toBe('interrupted by signal')
  })

  it('a guest that never started still gets a failed section', () => {
    const log = parseVzdumpLog(notFound as TaskLogLine[])
    expect(log.guests).toHaveLength(1)
    expect(log.guests[0]).toMatchObject({ vmid: 111, type: null, status: 'failed', reason: "unable to find VM '111'" })
  })

  it('a finished guest with a WARN line is ok_warnings', () => {
    const lines = [...(localQemu as TaskLogLine[])]
    lines.splice(3, 0, { n: 999, t: 'WARN: guest agent not responding' })
    const vm = parseVzdumpLog(lines).guests[0]
    expect(vm.status).toBe('ok_warnings')
    expect(vm.warnings).toEqual(['WARN: guest agent not responding'])
  })

  it('maps protected-flag and hook failures after data to their step', () => {
    const base = (reason: string): TaskLogLine[] => [
      { n: 1, t: 'INFO: starting new backup job: vzdump 5 --storage local' },
      { n: 2, t: 'INFO: Starting Backup of VM 5 (qemu)' },
      { n: 3, t: 'INFO: archive file size: 10MB' },
      { n: 4, t: `ERROR: Backup of VM 5 failed - ${reason}` },
    ]
    expect(parseVzdumpLog(base('unable to set protected flag - denied')).guests[0].step).toBe('protected')
    expect(parseVzdumpLog(base("hook script 'backup-end' failed")).guests[0].step).toBe('hook')
    expect(parseVzdumpLog(base('something else')).guests[0].step).toBe('other')
  })

  it('an open section is running while the task runs, failed once it stopped', () => {
    const lines: TaskLogLine[] = [
      { n: 1, t: 'INFO: starting new backup job: vzdump 5 --storage local' },
      { n: 2, t: 'INFO: Starting Backup of VM 5 (qemu)' },
    ]
    expect(parseVzdumpLog(lines, { running: true }).guests[0].status).toBe('running')
    const stopped = parseVzdumpLog(lines, { exitStatus: 'unexpected status' }).guests[0]
    expect(stopped.status).toBe('failed')
    expect(stopped.reason).toBe('unexpected status')
  })

  it('never throws on unknown lines', () => {
    expect(() => parseVzdumpLog([{ n: 1, t: '???' }, { n: 2, t: '' }])).not.toThrow()
  })
})

import { describe, it, expect } from 'vitest'

import {
  jobInvocation,
  normalizeVzdumpValue,
  parseVzdumpCommandLine,
  shellSplit,
} from './vzdumpCommandLine'

// First line of the scheduled probe run on the lab (PVE 9.2.11): option order
// is Perl hash order, property strings and templates are shell-quoted.
const SCHEDULED =
  "INFO: starting new backup job: vzdump 9882 --compress zstd --mode snapshot --storage pbs-msp-msppveprod --notes-template '{{guestname}} probe' --quiet 1 --prune-backups 'keep-daily=2,keep-last=3'"

// The same job as GET /cluster/backup returns it.
const PROBE_JOB = {
  comment: 'issue 1003 probe, delete me',
  compress: 'zstd',
  enabled: 1,
  id: 'e2e-1003-probe',
  mode: 'snapshot',
  'next-run': 1790256480,
  'notes-template': '{{guestname}} probe',
  'prune-backups': { 'keep-daily': '2', 'keep-last': '3' },
  schedule: '15:28',
  storage: 'pbs-msp-msppveprod',
  type: 'vzdump',
  vmid: '9882',
}

describe('shellSplit', () => {
  it('splits on blanks and keeps single-quoted values whole', () => {
    expect(shellSplit("vzdump 1 --notes-template '{{guestname}} probe'")).toEqual([
      'vzdump', '1', '--notes-template', '{{guestname}} probe',
    ])
  })

  it("rejoins PVE's quoting of an embedded single quote ('\"'\"')", () => {
    expect(shellSplit(`--notes-template 'it'"'"'s'`)).toEqual(['--notes-template', "it's"])
  })

  it('keeps an empty quoted value as a token', () => {
    expect(shellSplit("--comment ''")).toEqual(['--comment', ''])
  })
})

describe('normalizeVzdumpValue', () => {
  it('prints a property-string object with sorted keys, like PVE', () => {
    expect(normalizeVzdumpValue('prune-backups', { 'keep-last': '3', 'keep-daily': 2 })).toBe('keep-daily=2,keep-last=3')
  })

  it('reorders a property string given as text', () => {
    expect(normalizeVzdumpValue('fleecing', 'storage=local,enabled=1')).toBe('enabled=1,storage=local')
  })

  it('maps booleans to 1/0 and numbers to text', () => {
    expect(normalizeVzdumpValue('protected', true)).toBe('1')
    expect(normalizeVzdumpValue('bwlimit', 51200)).toBe('51200')
  })

  it('normalises mailto separators', () => {
    expect(normalizeVzdumpValue('mailto', 'a@x.io; b@x.io')).toBe('a@x.io,b@x.io')
  })
})

describe('parseVzdumpCommandLine', () => {
  it('parses the scheduled line: vmids, quiet marker, unordered options', () => {
    const inv = parseVzdumpCommandLine(SCHEDULED)!
    expect(inv.vmids).toEqual([9882])
    expect(inv.quiet).toBe(true)
    expect(inv.node).toBeNull()
    expect(inv.options).toEqual({
      compress: 'zstd',
      mode: 'snapshot',
      storage: 'pbs-msp-msppveprod',
      'notes-template': '{{guestname}} probe',
      'prune-backups': 'keep-daily=2,keep-last=3',
    })
  })

  it('reads several positional vmids and --node from an API run', () => {
    const inv = parseVzdumpCommandLine(
      'INFO: starting new backup job: vzdump 101 9911 9882 --node pve1 --compress zstd --storage pbs-msp-msppveprod --mode snapshot',
    )!
    expect(inv.vmids).toEqual([101, 9882, 9911])
    expect(inv.node).toBe('pve1')
    expect(inv.quiet).toBe(false)
    expect(inv.options).not.toHaveProperty('node')
  })

  it('reads --all and --exclude as selection, not as options', () => {
    const inv = parseVzdumpCommandLine('INFO: starting new backup job: vzdump --all 1 --exclude 100,101 --storage local --quiet 1')!
    expect(inv.all).toBe(true)
    expect(inv.exclude).toEqual([100, 101])
    expect(inv.vmids).toEqual([])
    expect(inv.options).toEqual({ storage: 'local' })
  })

  it('reads --pool', () => {
    expect(parseVzdumpCommandLine('INFO: starting new backup job: vzdump --pool tenant-a --storage pbs')!.pool).toBe('tenant-a')
  })

  it('returns null for any other line', () => {
    expect(parseVzdumpCommandLine('INFO: Starting Backup of VM 100 (qemu)')).toBeNull()
    expect(parseVzdumpCommandLine('')).toBeNull()
  })
})

describe('jobInvocation', () => {
  it('rebuilds exactly what the scheduler prints for the probe job', () => {
    const fromJob = jobInvocation(PROBE_JOB)
    const fromLine = parseVzdumpCommandLine(SCHEDULED)!
    expect(fromJob.options).toEqual(fromLine.options)
    expect(fromJob.vmids).toEqual([9882])
    expect(fromJob.node).toBeNull()
  })

  it('drops job metadata and restricted/deprecated keys from the options', () => {
    const inv = jobInvocation({
      id: 'j', type: 'vzdump', enabled: 1, schedule: 'sat 02:00', comment: 'c', 'repeat-missed': 1,
      'next-run': 1, storage: 'pbs', tmpdir: '/tmp', dumpdir: '/d', script: '/s', mailnotification: 'always',
      all: 1, exclude: '100', node: 'pve1',
    })
    expect(inv.options).toEqual({ storage: 'pbs' })
    expect(inv.all).toBe(true)
    expect(inv.exclude).toEqual([100])
    expect(inv.node).toBe('pve1')
  })
})

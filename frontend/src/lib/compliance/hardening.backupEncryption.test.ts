import { describe, it, expect } from 'vitest'
import { runAllChecks, type HardeningData } from './hardening'

const PBS_ENC = { storage: 'pbs-enc', type: 'pbs', 'encryption-key': 'aa:bb:cc' }
const PBS_PLAIN = { storage: 'pbs-plain', type: 'pbs' }
const NFS = { storage: 'nfs-archive', type: 'nfs' }

function check(data: HardeningData) {
  const c = runAllChecks(data).find(x => x.id === 'backup_encryption')
  if (!c) throw new Error('backup_encryption not emitted')
  return c
}

describe('backup_encryption check', () => {
  it('passes when every enabled job writes to a PBS storage with an encryption key', () => {
    const c = check({ backupJobs: [{ id: 'j1', storage: 'pbs-enc' }, { id: 'j2', storage: 'pbs-enc', enabled: 1 }], storages: [PBS_ENC] })
    expect(c.status).toBe('pass')
    expect(c.earned).toBe(c.maxPoints)
    expect(c.details).toMatch(/All 2 enabled backup job/)
  })

  it('fails on a PBS storage without encryption key and on a non-PBS storage', () => {
    const c = check({
      backupJobs: [{ id: 'j1', storage: 'pbs-enc' }, { id: 'j2', storage: 'pbs-plain' }, { id: 'j3', storage: 'nfs-archive' }],
      storages: [PBS_ENC, PBS_PLAIN, NFS],
    })
    expect(c.status).toBe('fail')
    expect(c.earned).toBe(0)
    expect(c.details).toContain('2 of 3')
    expect(c.details).toContain('j2 -> pbs-plain (PBS storage without encryption key)')
    expect(c.details).toContain('j3 -> nfs-archive (nfs storage, not encrypted by Proxmox)')
  })

  it('fails on a job without target storage or with a storage that no longer exists', () => {
    const c = check({ backupJobs: [{ id: 'j1' }, { id: 'j2', storage: 'gone' }], storages: [PBS_ENC] })
    expect(c.status).toBe('fail')
    expect(c.details).toContain('j1 -> ? (no target storage)')
    expect(c.details).toContain('j2 -> gone (unknown storage)')
  })

  it('ignores disabled jobs', () => {
    const c = check({ backupJobs: [{ id: 'j1', storage: 'pbs-enc' }, { id: 'off', storage: 'nfs-archive', enabled: 0 }], storages: [PBS_ENC, NFS] })
    expect(c.status).toBe('pass')
  })

  it('is skipped without enabled job, and when the storage configuration could not be read', () => {
    expect(check({ backupJobs: [] }).status).toBe('skip')
    expect(check({ backupJobs: [{ id: 'off', storage: 'nfs-archive', enabled: 0 }], storages: [NFS] }).status).toBe('skip')
    const unread = check({ backupJobs: [{ id: 'j1', storage: 'pbs-enc' }] })
    expect(unread.status).toBe('skip')
    expect(unread.details).toMatch(/could not be read/)
  })

  it('caps the listed jobs at five', () => {
    const jobs = Array.from({ length: 7 }, (_, i) => ({ id: `j${i}`, storage: 'nfs-archive' }))
    const c = check({ backupJobs: jobs, storages: [NFS] })
    expect(c.details).toContain('+2 more')
    expect(c.details).not.toContain('j5 ->')
  })
})

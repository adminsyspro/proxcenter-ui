import { describe, expect, it } from 'vitest'

import {
  createJobRequestSchema,
  guestRestoreDestinationSchema,
  guestRestoreSshPinnedSchema,
  guestRestoreSshSchema,
  hostKeyFingerprintSchema,
  listJobsQuerySchema,
  probeRequestSchema,
} from './schemas'

const FINGERPRINT = 'SHA256:' + 'A'.repeat(43)

const target = { connId: 'c1', node: 'pve1', type: 'qemu', vmid: 100 }
const pve = { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'backup/vm/100/2026-09-20T18:51:49Z' }
const pbs = { kind: 'pbs', pbsId: 'p1', datastore: 'ds', namespace: 'tenant-a', backupType: 'ct', backupId: '101', backupTime: 1758718249, archive: 'root.pxar.didx' }

function job(over: object = {}) {
  return createJobRequestSchema.safeParse({
    source: pve,
    items: [{ path: '/drive-scsi0.img.fidx/part/1/etc/hosts', directory: false, size: 20 }],
    target,
    method: 'agent',
    destination: { mode: 'original' },
    ...over,
  })
}

describe('createJobRequestSchema', () => {
  it('accepts a pve and a pbs job', () => {
    expect(job().success).toBe(true)
    expect(job({ source: pbs, items: [{ path: '/etc/apt', directory: true }], method: 'ssh', ssh: { host: 'h', username: 'root', password: 'p', hostKeyFingerprint: FINGERPRINT } }).success).toBe(true)
  })
  it('requires a well-formed host key fingerprint on the SSH credentials of a job', () => {
    expect(job({ method: 'ssh', ssh: { host: 'h', username: 'root', password: 'p' } }).success).toBe(false)
    expect(job({ method: 'ssh', ssh: { host: 'h', username: 'root', password: 'p', hostKeyFingerprint: 'SHA256:short' } }).success).toBe(false)
    expect(guestRestoreSshPinnedSchema.safeParse({ host: 'h', username: 'u', privateKey: 'k', hostKeyFingerprint: FINGERPRINT }).success).toBe(true)
    expect(guestRestoreSshPinnedSchema.safeParse({ host: 'h', username: 'u', hostKeyFingerprint: FINGERPRINT }).success).toBe(false)
    expect(hostKeyFingerprintSchema.safeParse('SHA256:' + 'a'.repeat(43)).success).toBe(true)
    expect(hostKeyFingerprintSchema.safeParse('MD5:aa:bb').success).toBe(false)
  })
  it('refuses path traversal and relative item paths', () => {
    expect(job({ items: [{ path: '/etc/../../root', directory: false }] }).success).toBe(false)
    expect(job({ items: [{ path: 'etc/hosts', directory: false }] }).success).toBe(false)
    expect(job({ items: [{ path: '/etc/\0hosts', directory: false }] }).success).toBe(false)
  })
  it('bounds the item list', () => {
    expect(job({ items: [] }).success).toBe(false)
    expect(job({ items: Array.from({ length: 201 }, (_, i) => ({ path: `/drive-scsi0.img.fidx/part/1/f${i}`, directory: false })) }).success).toBe(false)
  })
  it('refuses a pbs source whose archive is not pxar', () => {
    expect(job({ source: { ...pbs, archive: 'drive-scsi0.img.fidx' } }).success).toBe(false)
    expect(job({ source: { ...pbs, archive: '../root.pxar.didx' } }).success).toBe(false)
  })
  it('refuses a whole disk, partition, LV or archive as an item', () => {
    for (const path of ['/drive-scsi0.img.fidx', '/drive-scsi0.img.fidx/part', '/drive-scsi0.img.fidx/part/1', '/drive-scsi0.img.fidx/lvm/vg0/root', '/root.pxar.didx', '/no-archive/etc']) {
      expect(job({ items: [{ path, directory: true }] }).success, path).toBe(false)
    }
    expect(job({ source: pbs, items: [{ path: '/', directory: true }] }).success).toBe(false)
    expect(job({ items: [{ path: '/drive-scsi0.img.fidx/lvm/vg0/root/etc', directory: true }] }).success).toBe(true)
  })
  it('refuses unknown methods, conflicts and modes', () => {
    expect(job({ method: 'ftp' }).success).toBe(false)
    expect(job({ conflict: 'rename' }).success).toBe(false)
    expect(job({ destination: { mode: 'elsewhere' } }).success).toBe(false)
  })
})

describe('destination and ssh schemas', () => {
  it('accepts absolute folders on both OS and refuses climbing', () => {
    const ok = (d: object) => guestRestoreDestinationSchema.safeParse(d).success
    expect(ok({ mode: 'custom', path: '/var/tmp/restore' })).toBe(true)
    expect(ok({ mode: 'custom', path: 'C:\\Restore' })).toBe(true)
    expect(ok({ mode: 'custom', path: '' })).toBe(true)
    expect(ok({ mode: 'custom', path: 'relative' })).toBe(false)
    expect(ok({ mode: 'custom', path: '/var/../etc' })).toBe(false)
    expect(ok({ mode: 'original', windowsDrive: 'D' })).toBe(true)
    expect(ok({ mode: 'original', windowsDrive: 'DD' })).toBe(false)
  })
  it('requires a password or a key, the fingerprint being optional for a probe', () => {
    expect(guestRestoreSshSchema.safeParse({ host: 'h', username: 'u' }).success).toBe(false)
    expect(guestRestoreSshSchema.safeParse({ host: 'h', username: 'u', password: 'p' }).success).toBe(true)
    expect(guestRestoreSshSchema.safeParse({ host: 'h', username: 'u', privateKey: 'k', passphrase: 'p' }).success).toBe(true)
    expect(guestRestoreSshSchema.safeParse({ host: 'h', port: 70000, username: 'u', password: 'p' }).success).toBe(false)
  })
})

describe('probe and list schemas', () => {
  it('validates the probe body', () => {
    expect(probeRequestSchema.safeParse({ target, method: 'agent' }).success).toBe(true)
    expect(probeRequestSchema.safeParse({ target: { ...target, vmid: '100' }, method: 'agent' }).success).toBe(false)
  })
  it('coerces the list query', () => {
    expect(listJobsQuerySchema.parse({ vmid: '100', limit: '10' })).toEqual({ vmid: 100, limit: 10 })
    expect(listJobsQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(listJobsQuerySchema.safeParse({ limit: '500' }).success).toBe(false)
  })
})

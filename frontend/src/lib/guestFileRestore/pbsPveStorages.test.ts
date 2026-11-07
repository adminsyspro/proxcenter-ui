import { describe, expect, it } from 'vitest'

import { matchingPbsStorages, normalizeFingerprint, pbsHostOf, pbsIdentityOf, samePbsServer, sameServer } from './pbsPveStorages'

const storages = [
  { storage: 'local', type: 'dir', path: '/var/lib/vz' },
  { storage: 'pbs-prod', type: 'pbs', server: '10.42.0.201', datastore: 'test-vdc', namespace: 'tenant-msp/vdc-msp-pve-prod', nodes: 'pve2,pve3,pve1' },
  { storage: 'pbs-root', type: 'pbs', server: '10.42.0.201', datastore: 'test-vdc' },
  { storage: 'pbs-other', type: 'pbs', server: 'pbs.example.org', datastore: 'test-vdc', namespace: 'tenant-msp/vdc-msp-pve-prod' },
]

describe('pbsPveStorages', () => {
  it('extracts the host of a PBS connection', () => {
    expect(pbsHostOf('https://10.42.0.201:8007')).toBe('10.42.0.201')
    expect(pbsHostOf('https://[fd00::1]:8007/')).toBe('fd00::1')
    expect(pbsHostOf('PBS.Example.ORG')).toBe('pbs.example.org')
  })
  it('compares servers as written, case-insensitively', () => {
    expect(sameServer(' 10.42.0.201 ', '10.42.0.201')).toBe(true)
    expect(sameServer('PBS.example.org', 'pbs.example.org')).toBe(true)
    expect(sameServer(undefined, 'x')).toBe(false)
  })
  it('matches on server, datastore and namespace, with the node list', () => {
    expect(matchingPbsStorages(storages, { host: '10.42.0.201', datastore: 'test-vdc', namespace: 'tenant-msp/vdc-msp-pve-prod' })).toEqual([
      { storage: 'pbs-prod', nodes: ['pve2', 'pve3', 'pve1'] },
    ])
    expect(matchingPbsStorages(storages, { host: '10.42.0.201', datastore: 'test-vdc', namespace: '' })).toEqual([{ storage: 'pbs-root', nodes: [] }])
    expect(matchingPbsStorages(storages, { host: '10.42.0.201', datastore: 'other', namespace: '' })).toEqual([])
    expect(matchingPbsStorages(null, { host: 'h', datastore: 'd', namespace: '' })).toEqual([])
  })

  // ui#1308: a storage named after a site convention, its server written by
  // FQDN while ProxCenter reaches the PBS by IP.
  const FP = '17:44:52:4E:99:EA:D8:04:7E:15:CB:EA:F3:7D:43:56:8F:23:D2:D7:B2:43:26:F4:E6:13:C8:9C:4A:E4:AC:21'
  const OTHER_FP = 'AA' + FP.slice(2)

  it('normalizes a SHA-256 fingerprint and rejects anything else', () => {
    expect(normalizeFingerprint(FP.toLowerCase())).toBe(FP.replace(/:/g, ''))
    expect(normalizeFingerprint(FP.replace(/:/g, ''))).toBe(FP.replace(/:/g, ''))
    expect(normalizeFingerprint('AA:BB')).toBe('')
    expect(normalizeFingerprint(null)).toBe('')
    expect(normalizeFingerprint(42)).toBe('')
  })
  it('recognizes the server by host or by pinned certificate', () => {
    const identity = pbsIdentityOf({ baseUrl: 'https://10.42.0.201:8007', fingerprint: FP })
    expect(identity).toEqual({ host: '10.42.0.201', fingerprint: FP })
    expect(samePbsServer({ server: '10.42.0.201' }, identity)).toBe(true)
    expect(samePbsServer({ server: 'pbs.test.com', fingerprint: FP.toLowerCase() }, identity)).toBe(true)
    expect(samePbsServer({ server: 'pbs.test.com', fingerprint: OTHER_FP }, identity)).toBe(false)
    expect(samePbsServer({ server: 'pbs.test.com' }, identity)).toBe(false)
    // No fingerprint pinned on the connection: two storages without one must not meet on ''.
    expect(samePbsServer({ server: 'pbs.test.com' }, { host: '10.42.0.201', fingerprint: null })).toBe(false)
    expect(samePbsServer({ server: 'pbs.test.com', fingerprint: 'garbage' }, { host: '10.42.0.201', fingerprint: 'garbage' })).toBe(false)
  })
  it('matches whatever the storage ID, by host or fingerprint, never by datastore alone', () => {
    const fleet = [
      { storage: 'SZ-PBS-Backup', type: 'pbs', server: '10.42.0.201', datastore: 'test-vdc' },
      { storage: 'WH-PBS-Store', type: 'pbs', server: 'pbs.test.com', datastore: 'test-vdc', fingerprint: FP, nodes: 'pve1-dr' },
      { storage: 'other-pbs', type: 'pbs', server: 'pbs.other.lan', datastore: 'test-vdc', fingerprint: OTHER_FP },
    ]
    expect(matchingPbsStorages(fleet, { host: '10.42.0.201', fingerprint: FP, datastore: 'test-vdc', namespace: '' })).toEqual([
      { storage: 'SZ-PBS-Backup', nodes: [] },
      { storage: 'WH-PBS-Store', nodes: ['pve1-dr'] },
    ])
    expect(matchingPbsStorages(fleet, { host: '10.42.0.201', datastore: 'test-vdc', namespace: '' })).toEqual([
      { storage: 'SZ-PBS-Backup', nodes: [] },
    ])
  })
})

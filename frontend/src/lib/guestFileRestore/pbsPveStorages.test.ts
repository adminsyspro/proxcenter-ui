import { describe, expect, it } from 'vitest'

import { matchingPbsStorages, pbsHostOf, sameServer } from './pbsPveStorages'

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
})

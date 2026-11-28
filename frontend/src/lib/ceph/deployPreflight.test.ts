import { describe, expect, it } from 'vitest'

import { cephNodeState, defaultRepository, installStatus, publicNetworkOf, readReleases } from './deployPreflight'

/*
   ui#1450: what the deploy wizard reads of each node. The messages are PVE's
   own (PVE/Ceph/Tools.pm, PVE 9.2.26): "binary not installed: ..." without
   the packages, "pveceph configuration not initialized - ..." before init.
*/

describe('cephNodeState', () => {
  it('reads the state of Ceph on a node from its status read', () => {
    expect(cephNodeState({ ok: true })).toBe('initialized')
    expect(cephNodeState({ error: { message: 'binary not installed: /usr/bin/ceph-mon\n', statusCode: 500 } })).toBe('absent')
    expect(cephNodeState({ error: { statusCode: 501, message: 'Not implemented' } })).toBe('absent')
    expect(cephNodeState({ error: { message: "pveceph configuration not initialized - missing '/etc/pve/ceph.conf'" } })).toBe('installed')
    expect(cephNodeState({ error: { message: 'rados_connect failed - timeout' } })).toBe('unknown')
  })
})

describe('installStatus', () => {
  it('reads the install log of the SSH account', () => {
    expect(installStatus(null)).toBe('UNKNOWN')
    expect(installStatus('update available package list\nunpacking ceph-mon')).toBe('RUNNING')
    expect(installStatus('installed ceph tentacle successfully!\nPXC_EXIT:0')).toBe('COMPLETED')
    expect(installStatus('E: Failed to fetch https://enterprise.proxmox.com/... 401 Unauthorized\nPXC_EXIT:100')).toBe('FAILED')
  })
})

describe('wizard defaults', () => {
  it('proposes the /24 of the node address as the public network', () => {
    expect(publicNetworkOf('10.42.0.101')).toBe('10.42.0.0/24')
    expect(publicNetworkOf('fd00::5')).toBe('')
    expect(publicNetworkOf(null)).toBe('')
  })

  it('takes the enterprise repository on a node with an active subscription only', () => {
    expect(defaultRepository({ status: 'active' })).toBe('enterprise')
    expect(defaultRepository({ status: 'notfound' })).toBe('no-subscription')
    expect(defaultRepository(null)).toBe('no-subscription')
  })

  it('keeps the releases PVE offers that ProxCenter installs', () => {
    const releases = [
      { release: 'reef', available: 0, 'is-default': 0 },
      { release: 'squid', available: 1, 'is-default': 0 },
      { release: 'tentacle', available: 1, 'is-default': 1 },
      { release: 'umbrella', available: 1, 'is-default': 0, unsupported: 1 },
    ]
    expect(readReleases(releases)).toEqual(['tentacle', 'squid'])
    expect(readReleases(null)).toEqual(['tentacle', 'squid'])
  })
})

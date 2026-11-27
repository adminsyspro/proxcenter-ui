import { describe, test, expect } from 'vitest'
import { correlateNodes } from './topologyCorrelate'
import type { VmIdentity } from './vmIdentity'

// Real RFC-4122 shaped UUIDs used across fixtures
const UUID1 = '550e8400-e29b-41d4-a716-446655440001'
const UUID2 = '550e8400-e29b-41d4-a716-446655440002'
const UUID3 = '550e8400-e29b-41d4-a716-446655440003'

// Helpers
const vm = (overrides: Partial<VmIdentity> & { vmid: number }): VmIdentity => ({
  name: `vm${overrides.vmid}`,
  host: 'pve',
  connectionId: 'c1',
  uuid: null,
  ips: [],
  ...overrides,
})

describe('correlateNodes', () => {
  // --- uuid key ---

  test('uuid match wins, confidence high', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: UUID1, internalIP: '10.0.0.9', providerID: '' }],
      [vm({ vmid: 107, name: 'x', host: 'pve', connectionId: 'c1', uuid: UUID1, ips: ['10.0.0.9'] })],
    )
    expect(out[0].match).toMatchObject({ key: 'uuid', vmid: 107, confidence: 'high' })
    expect(out[0].unmatchedReason).toBeUndefined()
  })

  test('uuid match is case-insensitive (node uuid uppercased -> lowercased before compare)', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: UUID1.toUpperCase(), internalIP: '', providerID: '' }],
      [vm({ vmid: 1, uuid: UUID1, ips: [] })],
    )
    expect(out[0].match?.key).toBe('uuid')
  })

  test('blank systemUUID is ignored (skips to next key)', () => {
    const out = correlateNodes(
      [{ name: 'kube-w1', systemUUID: '', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'kube-w1', uuid: null, ips: [] })],
    )
    // Should fall through to name match
    expect(out[0].match?.key).toBe('name')
  })

  test('blank/malformed uuid ignored; no candidate -> none', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: 'not-a-real-uuid!!!', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'different', uuid: null, ips: [] })],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('none')
  })

  test('duplicate uuid across vms -> ambiguous on uuid key', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: UUID3, internalIP: '', providerID: '' }],
      [
        vm({ vmid: 10, uuid: UUID3, ips: [] }),
        vm({ vmid: 11, uuid: UUID3, ips: [] }),
      ],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('ambiguous')
  })

  // --- providerID key ---

  test('providerID VMID match above ip/name', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.5', providerID: 'proxmox://pve/107' }],
      [
        vm({ vmid: 107, name: 'other', uuid: null, ips: ['10.0.0.5'] }),
        vm({ vmid: 200, name: 'w1', uuid: null, ips: [] }),
      ],
    )
    expect(out[0].match).toMatchObject({ key: 'providerID', vmid: 107, confidence: 'high' })
  })

  test('providerID with no matching vmid falls through to ip', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.1', providerID: 'proxmox://pve/999' }],
      [vm({ vmid: 1, name: 'w1', uuid: null, ips: ['10.0.0.1'] })],
    )
    // vmid 999 not in map, falls through
    expect(out[0].match?.key).toBe('ip')
  })

  test('empty providerID is skipped', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.1', providerID: '' }],
      [vm({ vmid: 5, name: 'other', uuid: null, ips: ['10.0.0.1'] })],
    )
    expect(out[0].match?.key).toBe('ip')
  })

  // --- ip key ---

  test('ip match, confidence medium', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '192.168.1.10', providerID: '' }],
      [vm({ vmid: 55, name: 'other', uuid: null, ips: ['192.168.1.10'] })],
    )
    expect(out[0].match).toMatchObject({ key: 'ip', vmid: 55, confidence: 'medium' })
  })

  test('duplicate IP across vms -> ambiguous on ip key', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.1', providerID: '' }],
      [
        vm({ vmid: 1, uuid: null, ips: ['10.0.0.1'] }),
        vm({ vmid: 2, uuid: null, ips: ['10.0.0.1'] }),
      ],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('ambiguous')
  })

  test('empty internalIP is skipped', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'w1', uuid: null, ips: [] })],
    )
    // falls through to name
    expect(out[0].match?.key).toBe('name')
  })

  // --- name key ---

  test('name match flagged low confidence', () => {
    const out = correlateNodes(
      [{ name: 'kube-w1', systemUUID: '', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'kube-w1', uuid: null, ips: [] })],
    )
    expect(out[0].match).toMatchObject({ key: 'name', confidence: 'low' })
  })

  test('name match is case-insensitive', () => {
    const out = correlateNodes(
      [{ name: 'KUBE-W1', systemUUID: '', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'kube-w1', uuid: null, ips: [] })],
    )
    expect(out[0].match?.key).toBe('name')
  })

  test('duplicate name -> ambiguous -> unmapped', () => {
    const out = correlateNodes(
      [{ name: 'dup', systemUUID: '', internalIP: '', providerID: '' }],
      [
        vm({ vmid: 1, name: 'dup', host: 'a', connectionId: 'c1', uuid: null, ips: [] }),
        vm({ vmid: 2, name: 'dup', host: 'b', connectionId: 'c1', uuid: null, ips: [] }),
      ],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('ambiguous')
  })

  test('short-name normalization: node FQDN matches VM short name via name key', () => {
    const out = correlateNodes(
      [{ name: 'w1.cluster.local', systemUUID: '', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'w1', uuid: null, ips: [] })],
    )
    expect(out[0].match).toMatchObject({ key: 'name', confidence: 'low' })
  })

  // --- ambiguity stops cascade (does NOT fall through) ---

  test('ambiguous IP stops cascade; does not fall through to name match', () => {
    const out = correlateNodes(
      [{ name: 'unique-name', systemUUID: '', internalIP: '10.0.0.1', providerID: '' }],
      [
        // Two VMs share the same IP -> ambiguous at ip key
        vm({ vmid: 1, name: 'other-a', uuid: null, ips: ['10.0.0.1'] }),
        vm({ vmid: 2, name: 'other-b', uuid: null, ips: ['10.0.0.1'] }),
        // A third VM matches the node name (unique-name) - must NOT be used
        vm({ vmid: 3, name: 'unique-name', uuid: null, ips: [] }),
      ],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('ambiguous')
  })

  // --- no match ---

  test('no key matches -> unmatchedReason none', () => {
    const out = correlateNodes(
      [{ name: 'ghost', systemUUID: '', internalIP: '1.2.3.4', providerID: '' }],
      [vm({ vmid: 1, name: 'other', uuid: null, ips: ['9.9.9.9'] })],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('none')
  })

  // --- output shape ---

  test('match includes vmName, host, connectionId', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.1', providerID: '' }],
      [vm({ vmid: 7, name: 'worker', host: 'pve1', connectionId: 'conn-x', uuid: null, ips: ['10.0.0.1'] })],
    )
    expect(out[0].match).toMatchObject({ vmName: 'worker', host: 'pve1', connectionId: 'conn-x' })
  })

  test('match includes clusterName when present on vm', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.1', providerID: '' }],
      [vm({ vmid: 7, name: 'worker', host: 'pve1', connectionId: 'conn-x', clusterName: 'prod', uuid: null, ips: ['10.0.0.1'] })],
    )
    expect(out[0].match?.clusterName).toBe('prod')
  })

  test('multiple nodes correlated independently', () => {
    const out = correlateNodes(
      [
        { name: 'w1', systemUUID: UUID1, internalIP: '', providerID: '' },
        { name: 'w2', systemUUID: UUID2, internalIP: '', providerID: '' },
        { name: 'w3', systemUUID: '', internalIP: '', providerID: '' },
      ],
      [
        vm({ vmid: 1, uuid: UUID1, ips: [] }),
        vm({ vmid: 2, uuid: UUID2, ips: [] }),
      ],
    )
    expect(out[0].match?.vmid).toBe(1)
    expect(out[1].match?.vmid).toBe(2)
    expect(out[2].unmatchedReason).toBe('none')
  })

  test('empty nodes returns empty array', () => {
    expect(correlateNodes([], [])).toEqual([])
  })

  test('empty vms -> all nodes unmatchedReason none', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: 'abc', internalIP: '1.2.3.4', providerID: 'proxmox://pve/1' }],
      [],
    )
    expect(out[0].unmatchedReason).toBe('none')
  })

  // --- multi-connection vmid collision ---

  test('providerID ambiguous when same vmid exists on two connections', () => {
    const out = correlateNodes(
      [{ name: 'w-shared', systemUUID: '', internalIP: '', providerID: 'proxmox://pve/100' }],
      [
        vm({ vmid: 100, uuid: null, ips: [], connectionId: 'c1' }),
        vm({ vmid: 100, uuid: null, ips: [], connectionId: 'c2' }),
      ],
    )
    expect(out[0].match).toBeUndefined()
    expect(out[0].unmatchedReason).toBe('ambiguous')
  })

  test('uuid resolves to correct connection VM even when another connection has same vmid', () => {
    const out = correlateNodes(
      [{ name: 'w2', systemUUID: UUID2, internalIP: '', providerID: 'proxmox://pve/100' }],
      [
        vm({ vmid: 100, uuid: UUID1, ips: [], connectionId: 'c1', name: 'vm-c1' }),
        vm({ vmid: 100, uuid: UUID2, ips: [], connectionId: 'c2', name: 'vm-c2' }),
      ],
    )
    expect(out[0].match?.key).toBe('uuid')
    expect(out[0].match?.connectionId).toBe('c2')
    expect(out[0].match?.vmName).toBe('vm-c2')
  })

  // --- authoritative key (persisted node mapping, DECISION 3) ---

  test('authoritative mapping wins over a conflicting heuristic (ip would match VM-B)', () => {
    const authoritative = new Map([['node-1', { connectionId: 'c1', vmid: 10 }]])
    const out = correlateNodes(
      // node-1's IP would heuristically match VM-B (vmid 20), but the
      // authoritative map says it is actually VM-A (vmid 10).
      [{ name: 'node-1', systemUUID: '', internalIP: '10.0.0.20', providerID: '' }],
      [
        vm({ vmid: 10, name: 'vm-a', host: 'pve1', connectionId: 'c1', uuid: null, ips: [] }),
        vm({ vmid: 20, name: 'vm-b', host: 'pve1', connectionId: 'c1', uuid: null, ips: ['10.0.0.20'] }),
      ],
      authoritative,
    )
    expect(out[0].match).toMatchObject({ key: 'authoritative', vmid: 10, vmName: 'vm-a', confidence: 'high' })
  })

  test('authoritative target absent from vms falls through to the heuristic cascade', () => {
    const authoritative = new Map([['node-1', { connectionId: 'c1', vmid: 999 }]])
    const out = correlateNodes(
      [{ name: 'node-1', systemUUID: '', internalIP: '10.0.0.20', providerID: '' }],
      [vm({ vmid: 20, name: 'vm-b', host: 'pve1', connectionId: 'c1', uuid: null, ips: ['10.0.0.20'] })],
      authoritative,
    )
    expect(out[0].match).toMatchObject({ key: 'ip', vmid: 20 })
  })

  test('a node absent from the authoritative map is unaffected (backward compatible)', () => {
    const authoritative = new Map([['other-node', { connectionId: 'c1', vmid: 10 }]])
    const out = correlateNodes(
      [{ name: 'node-1', systemUUID: '', internalIP: '', providerID: '' }],
      [vm({ vmid: 1, name: 'node-1', uuid: null, ips: [] })],
      authoritative,
    )
    expect(out[0].match?.key).toBe('name')
  })

  test('omitting the authoritative param is backward compatible', () => {
    const out = correlateNodes(
      [{ name: 'w1', systemUUID: '', internalIP: '10.0.0.1', providerID: '' }],
      [vm({ vmid: 1, name: 'other', uuid: null, ips: ['10.0.0.1'] })],
    )
    expect(out[0].match?.key).toBe('ip')
  })
})

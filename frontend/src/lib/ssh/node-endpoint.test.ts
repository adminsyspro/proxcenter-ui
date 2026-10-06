import { beforeEach, describe, expect, it, vi } from 'vitest'

const { hostFindUniqueMock, connFindUniqueMock, getNodeIpMock } = vi.hoisted(() => ({
  hostFindUniqueMock: vi.fn(),
  connFindUniqueMock: vi.fn(),
  getNodeIpMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    managedHost: { findUnique: hostFindUniqueMock },
    connection: { findUnique: connFindUniqueMock },
  },
}))
vi.mock('@/lib/ssh/node-ip', () => ({ getNodeIp: getNodeIpMock }))

import {
  buildOrchestratorSshOverrides,
  formatSshEndpoint,
  normalizeSshAddress,
  normalizeSshPort,
  pickNodeSshEndpoint,
  resolveNodeSshEndpoint,
  resolveSshTargetPort,
} from './node-endpoint'

beforeEach(() => {
  hostFindUniqueMock.mockReset().mockResolvedValue(null)
  connFindUniqueMock.mockReset().mockResolvedValue({ sshPort: 22 })
  getNodeIpMock.mockReset().mockResolvedValue('10.0.0.5')
})

describe('normalizeSshPort / normalizeSshAddress', () => {
  it('accepts integers in 1..65535, numeric strings included', () => {
    expect(normalizeSshPort(1)).toBe(1)
    expect(normalizeSshPort(65535)).toBe(65535)
    expect(normalizeSshPort(' 2201 ')).toBe(2201)
  })

  it('rejects everything else as null', () => {
    for (const v of [0, -1, 65536, 22.5, Number.NaN, 'abc', '', null, undefined, '22x']) {
      expect(normalizeSshPort(v), String(v)).toBeNull()
    }
  })

  it('trims addresses and turns blanks into null', () => {
    expect(normalizeSshAddress('  100.64.0.7 ')).toBe('100.64.0.7')
    expect(normalizeSshAddress('   ')).toBeNull()
    expect(normalizeSshAddress(null)).toBeNull()
    expect(normalizeSshAddress(42)).toBeNull()
  })
})

describe('pickNodeSshEndpoint: one priority rule for every caller', () => {
  it('the node override address wins over the reported one', () => {
    expect(pickNodeSshEndpoint({ reportedHost: '10.0.0.5', connSshPort: 22, override: { sshAddress: '100.64.0.7' } }))
      .toEqual({ host: '100.64.0.7', port: 22, source: 'override' })
  })

  it('without an override address the reported address is used', () => {
    expect(pickNodeSshEndpoint({ reportedHost: '10.0.0.5', connSshPort: 2222, override: { sshAddress: '  ' } }))
      .toEqual({ host: '10.0.0.5', port: 2222, source: 'proxmox' })
  })

  it('port: node override, else connection port, else 22', () => {
    expect(pickNodeSshEndpoint({ reportedHost: 'h', connSshPort: 2222, override: { sshPort: 2201 } }).port).toBe(2201)
    expect(pickNodeSshEndpoint({ reportedHost: 'h', connSshPort: 2222, override: { sshPort: null } }).port).toBe(2222)
    expect(pickNodeSshEndpoint({ reportedHost: 'h', connSshPort: null }).port).toBe(22)
  })

  it('an invalid stored port falls through to the next level', () => {
    expect(pickNodeSshEndpoint({ reportedHost: 'h', connSshPort: 2222, override: { sshPort: 70000 } }).port).toBe(2222)
    expect(pickNodeSshEndpoint({ reportedHost: 'h', connSshPort: 0 }).port).toBe(22)
  })
})

describe('resolveNodeSshEndpoint', () => {
  it('uses the stored override without asking Proxmox', async () => {
    hostFindUniqueMock.mockResolvedValueOnce({ sshAddress: '203.0.113.10', sshPort: 2202 })

    await expect(resolveNodeSshEndpoint({ id: 'c1' }, 'pve2'))
      .resolves.toEqual({ host: '203.0.113.10', port: 2202, source: 'override' })
    expect(getNodeIpMock).not.toHaveBeenCalled()
    expect(hostFindUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId_node: { connectionId: 'c1', node: 'pve2' } },
    }))
  })

  it('without an address override asks for the Proxmox address only, and keeps a port-only override', async () => {
    hostFindUniqueMock.mockResolvedValueOnce({ sshAddress: null, sshPort: 2203 })

    await expect(resolveNodeSshEndpoint({ id: 'c1' }, 'pve3'))
      .resolves.toEqual({ host: '10.0.0.5', port: 2203, source: 'proxmox' })
    expect(getNodeIpMock).toHaveBeenCalledWith({ id: 'c1' }, 'pve3', { skipOverride: true })
  })

  it('reads the connection port from the row when the connection object lacks it', async () => {
    connFindUniqueMock.mockResolvedValueOnce({ sshPort: 2222 })

    await expect(resolveNodeSshEndpoint({ id: 'c1' }, 'pve1')).resolves.toMatchObject({ port: 2222 })
  })

  it('takes a preloaded row and the connection port as given, with no query', async () => {
    await expect(resolveNodeSshEndpoint({ id: 'c1', sshPort: 2022 }, 'pve1', null))
      .resolves.toEqual({ host: '10.0.0.5', port: 2022, source: 'proxmox' })
    expect(hostFindUniqueMock).not.toHaveBeenCalled()
    expect(connFindUniqueMock).not.toHaveBeenCalled()
  })

  it('a failing lookup degrades to the Proxmox address and port 22', async () => {
    hostFindUniqueMock.mockRejectedValueOnce(new Error('db down'))
    connFindUniqueMock.mockRejectedValueOnce(new Error('db down'))

    await expect(resolveNodeSshEndpoint({ id: 'c1' }, 'pve1'))
      .resolves.toEqual({ host: '10.0.0.5', port: 22, source: 'proxmox' })
  })
})

describe('resolveSshTargetPort', () => {
  const db = (rows: any[]) => ({ managedHost: { findMany: vi.fn().mockResolvedValue(rows) } })

  it('an endpoint carries its own port', async () => {
    await expect(resolveSshTargetPort(db([]), 'c1', { host: 'h', port: 2201 }, 22)).resolves.toBe(2201)
    await expect(resolveSshTargetPort(db([]), 'c1', { host: 'h', port: null }, 2222)).resolves.toBe(2222)
  })

  it('a bare host takes the port of the one node it matches', async () => {
    const d = db([{ sshAddress: '100.64.0.7', ip: '10.0.0.5', sshPort: 2201 }])

    await expect(resolveSshTargetPort(d, 'c1', '100.64.0.7', 22)).resolves.toBe(2201)
    expect(d.managedHost.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { connectionId: 'c1', OR: [{ sshAddress: '100.64.0.7' }, { sshAddress: null, ip: '100.64.0.7' }] },
    }))
  })

  it('a bare host shared by nodes on distinct ports is ambiguous: connection port', async () => {
    const d = db([
      { sshAddress: '203.0.113.10', ip: null, sshPort: 2201 },
      { sshAddress: '203.0.113.10', ip: null, sshPort: 2202 },
    ])

    await expect(resolveSshTargetPort(d, 'c1', '203.0.113.10', 2222)).resolves.toBe(2222)
  })

  it('no match, no override port, or a failing query: connection port, else 22', async () => {
    await expect(resolveSshTargetPort(db([]), 'c1', '10.0.0.9', 2222)).resolves.toBe(2222)
    await expect(resolveSshTargetPort(db([{ sshAddress: null, ip: '10.0.0.9', sshPort: null }]), 'c1', '10.0.0.9', null)).resolves.toBe(22)
    const failing = { managedHost: { findMany: vi.fn().mockRejectedValue(new Error('x')) } }
    await expect(resolveSshTargetPort(failing, 'c1', '10.0.0.9', 2222)).resolves.toBe(2222)
  })
})

describe('formatSshEndpoint / buildOrchestratorSshOverrides', () => {
  it('formats host:port, brackets IPv6, leaves a bare host alone', () => {
    expect(formatSshEndpoint({ host: '203.0.113.10', port: 2201 })).toBe('203.0.113.10:2201')
    expect(formatSshEndpoint({ host: 'fd00::1', port: 22 })).toBe('[fd00::1]:22')
    expect(formatSshEndpoint('10.0.0.5')).toBe('10.0.0.5')
  })

  it('builds the object form, skipping nodes without any override', () => {
    expect(buildOrchestratorSshOverrides([
      { node: 'pve1', sshAddress: ' 203.0.113.10 ', sshPort: 2201 },
      { node: 'pve2', sshAddress: '100.64.0.8', sshPort: null },
      { node: 'pve3', sshAddress: '', sshPort: 2203 },
      { node: 'pve4', sshAddress: null, sshPort: null },
      { node: 'pve5', sshAddress: null, sshPort: 99999 },
    ])).toEqual({
      pve1: { address: '203.0.113.10', port: 2201 },
      pve2: { address: '100.64.0.8' },
      pve3: { address: '', port: 2203 },
    })
  })
})

/**
 * Proxmox VE 9.3 migration tunnel: a 9.3 source (qemu-server 9.2.21 /
 * pve-container 6.1.25 and later) refuses an older target. Versions measured
 * on the lab on 26/11/2026: PVE-DR 9.3.1 (qemu-server 9.2.24), PVE-PROD 9.2
 * (qemu-server 9.2.15, candidate 9.2.24).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pveFetchMock = vi.fn<(conn: any, path: string) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

const { checkMigrationTunnel, clearTunnelVersionCache, compareDotted, nodePackageVersion, tunnelTooOld, tunnelTooOldMessage } = await import('./tunnelVersion')

const SOURCE = { baseUrl: 'https://dr:8006', apiToken: 't' }
const TARGET = { baseUrl: 'https://prod:8006', apiToken: 't' }

const row = (Package: string, Version: string, OldVersion = Version) => ({ Package, Version, OldVersion, CurrentState: 'Installed' })

function pve(routes: Record<string, any>) {
  pveFetchMock.mockImplementation(async (conn, path) => {
    const key = `${conn.baseUrl}${path}`
    if (!(key in routes)) throw new Error(`unexpected PVE call ${key}`)
    const value = routes[key]
    if (value instanceof Error) throw value

    return value
  })
}

beforeEach(() => {
  pveFetchMock.mockReset()
  clearTunnelVersionCache()
})

describe('compareDotted', () => {
  it('compares part by part with missing parts as 0', () => {
    expect(compareDotted('9.2.21', '9.2.21')).toBe(0)
    expect(compareDotted('9.2.9', '9.2.21')).toBeLessThan(0)
    expect(compareDotted('9.3', '9.2.99')).toBeGreaterThan(0)
    expect(compareDotted('9.2', '9.2.0')).toBe(0)
  })
})

describe('tunnelTooOld', () => {
  it('refuses a v3 source with an older target', () => {
    expect(tunnelTooOld('qemu', '9.2.24', '9.2.15')).toEqual({ pkg: 'qemu-server', required: '9.2.21', sourceVersion: '9.2.24', targetVersion: '9.2.15' })
    expect(tunnelTooOld('lxc', '6.1.28', '6.1.18')?.pkg).toBe('pve-container')
  })

  it('passes when both are on the new tunnel, or the source is still old', () => {
    expect(tunnelTooOld('qemu', '9.2.24', '9.2.21')).toBeNull()
    expect(tunnelTooOld('qemu', '9.2.15', '9.2.24')).toBeNull()
    expect(tunnelTooOld('qemu', '9.2.15', '9.2.10')).toBeNull()
  })

  it('never blocks on an unknown version', () => {
    expect(tunnelTooOld('qemu', null, '9.2.15')).toBeNull()
    expect(tunnelTooOld('qemu', '9.2.24', null)).toBeNull()
  })
})

describe('nodePackageVersion', () => {
  it('reads the installed version, not the update candidate', async () => {
    pve({ 'https://prod:8006/nodes/pve2/apt/versions': [row('pve-manager', '9.3.1', '9.2.26'), row('qemu-server', '9.2.24', '9.2.15')] })
    expect(await nodePackageVersion(TARGET, 'pve2', 'qemu-server')).toBe('9.2.15')
  })

  it('keeps only the leading dotted number of a Debian version', async () => {
    pve({ 'https://prod:8006/nodes/pve2/apt/versions': [{ Package: 'qemu-server', Version: '9.2.24~bpo1' }] })
    expect(await nodePackageVersion(TARGET, 'pve2', 'qemu-server')).toBe('9.2.24')
  })

  it('answers null when the node cannot be read, and asks again next time', async () => {
    pve({ 'https://prod:8006/nodes/pve2/apt/versions': new Error('403 Permission check failed (Sys.Audit)') })
    expect(await nodePackageVersion(TARGET, 'pve2', 'qemu-server')).toBeNull()
    pve({ 'https://prod:8006/nodes/pve2/apt/versions': [row('qemu-server', '9.2.15')] })
    expect(await nodePackageVersion(TARGET, 'pve2', 'qemu-server')).toBe('9.2.15')
  })

  it('reads a node once within the cache window', async () => {
    pve({ 'https://prod:8006/nodes/pve2/apt/versions': [row('qemu-server', '9.2.15')] })
    await nodePackageVersion(TARGET, 'pve2', 'qemu-server')
    await nodePackageVersion(TARGET, 'pve2', 'qemu-server')
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('checkMigrationTunnel', () => {
  it('reports the lab case: PVE-DR 9.3.1 to PVE-PROD 9.2', async () => {
    pve({
      'https://dr:8006/nodes/pve2-dr/apt/versions': [row('qemu-server', '9.2.24')],
      'https://prod:8006/nodes/pve2/apt/versions': [row('qemu-server', '9.2.24', '9.2.15')],
    })
    const verdict = await checkMigrationTunnel('qemu', { conn: SOURCE, node: 'pve2-dr' }, { conn: TARGET, node: 'pve2' })
    expect(verdict).toEqual({ pkg: 'qemu-server', required: '9.2.21', sourceVersion: '9.2.24', targetVersion: '9.2.15' })
    expect(tunnelTooOldMessage(verdict!)).toContain('Upgrade the target cluster to Proxmox VE 9.3 first')
  })

  it('passes once the target is upgraded', async () => {
    pve({
      'https://dr:8006/nodes/pve2-dr/apt/versions': [row('qemu-server', '9.2.24')],
      'https://prod:8006/nodes/pve2/apt/versions': [row('qemu-server', '9.2.24')],
    })
    expect(await checkMigrationTunnel('qemu', { conn: SOURCE, node: 'pve2-dr' }, { conn: TARGET, node: 'pve2' })).toBeNull()
  })
})

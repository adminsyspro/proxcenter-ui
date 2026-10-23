import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkPermissionMock, getConnectionByIdMock, pveFetchMock, sdnOwnVnetsMock, auditMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  sdnOwnVnetsMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/vdc/sdnReadScope', async () => ({
  ...(await vi.importActual<typeof import('@/lib/vdc/sdnReadScope')>('@/lib/vdc/sdnReadScope')),
  sdnOwnVnets: sdnOwnVnetsMock,
}))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (_options: unknown, handler: any) => handler,
}))
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { POST as applySdn } from './apply/route'
import { GET as getControllers } from './controllers/route'
import { GET as getDns } from './dns/route'
import { GET as getFabrics } from './fabrics/route'
import { GET as getIpamStatus } from './ipams/[ipam]/status/route'
import { GET as getIpams } from './ipams/route'
import { GET as getStatus } from './status/route'
import { GET as getFirewallRules } from './vnets/[vnet]/firewall/rules/route'
import { GET as getVnets } from './vnets/route'
import { GET as getZones } from './zones/route'

const CONN = { id: 'conn-1', name: 'PVE' }
const OWN = new Set(['vnet-own'])

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  sdnOwnVnetsMock.mockResolvedValue(null)
  auditMock.mockResolvedValue(undefined)
})

describe('provider SDN reads stay unchanged', () => {
  it('returns every PVE VNet', async () => {
    const vnets = [{ vnet: 'vnet-own', zone: 'zone-own' }, { vnet: 'vnet-other', zone: 'zone-other' }]
    pveFetchMock.mockResolvedValue(vnets)

    const res = await callRoute(getVnets, { params: { id: 'conn-1' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { vnets } })
    expect(pveFetchMock).toHaveBeenCalledExactlyOnceWith(CONN, '/cluster/sdn/vnets?pending=1')
  })

  it('returns every PVE zone without fetching VNets', async () => {
    const zones = [{ zone: 'zone-own' }, { zone: 'zone-other' }]
    pveFetchMock.mockResolvedValue(zones)

    const res = await callRoute(getZones, { params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({ data: { zones } })
    expect(pveFetchMock).toHaveBeenCalledExactlyOnceWith(CONN, '/cluster/sdn/zones?pending=1')
  })

  it('computes status from all provider zones and VNets and exposes IPAM backends', async () => {
    pveFetchMock.mockImplementation((_conn: unknown, path: string) => {
      if (path === '/version') return Promise.resolve({ version: '9.1.0', repoid: 'enterprise' })
      if (path.includes('/zones')) return Promise.resolve([{ zone: 'zone-other', pending: true }])
      if (path.includes('/vnets')) return Promise.resolve([{ vnet: 'vnet-other', zone: 'zone-other' }])
      if (path === '/cluster/sdn/ipams') return Promise.resolve([{ ipam: 'pve' }, { ipam: 'phpipam' }])
      return Promise.resolve([])
    })

    const res = await callRoute(getStatus, { params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({
      data: {
        version: { release: '9.1.0', repoid: 'enterprise' },
        pveMajor: 9,
        pending: true,
        ipamBackends: ['pve', 'phpipam'],
      },
    })
  })

  const listRoutes = [
    { name: 'IPAMs', handler: getIpams, params: { id: 'conn-1' }, key: 'ipams', payload: [{ ipam: 'pve' }] },
    {
      name: 'IPAM allocations', handler: getIpamStatus, params: { id: 'conn-1', ipam: 'pve' },
      key: 'allocations', payload: [{ ip: '192.0.2.10' }],
    },
    { name: 'controllers', handler: getControllers, params: { id: 'conn-1' }, key: 'controllers', payload: [{ controller: 'evpn' }] },
    { name: 'DNS servers', handler: getDns, params: { id: 'conn-1' }, key: 'dns', payload: [{ dns: 'dns-1' }] },
  ]

  it.each(listRoutes)('returns the PVE $name list', async ({ handler, params, key, payload }) => {
    pveFetchMock.mockResolvedValue(payload)

    const res = await callRoute(handler, { params })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.data[key]).toEqual(payload)
    expect(pveFetchMock).toHaveBeenCalledOnce()
  })

  it('returns provider fabrics and nodes', async () => {
    const payload = { fabrics: [{ fabric: 'fab-1' }], nodes: [{ node: 'pve-1' }] }
    pveFetchMock.mockResolvedValue(payload)

    const res = await callRoute(getFabrics, { params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({ data: payload })
    expect(pveFetchMock).toHaveBeenCalledExactlyOnceWith(CONN, '/cluster/sdn/fabrics')
  })

  it('returns firewall rules for any provider VNet', async () => {
    const rules = [{ pos: 0, action: 'ACCEPT' }]
    pveFetchMock.mockResolvedValue(rules)

    const res = await callRoute(getFirewallRules, {
      params: { id: 'conn-1', vnet: 'vnet-other' },
    })

    expect(await readJson(res)).toEqual({ data: { rules } })
    expect(pveFetchMock).toHaveBeenCalledExactlyOnceWith(
      CONN,
      '/cluster/sdn/vnets/vnet-other/firewall/rules',
    )
  })

  it('applies the cluster SDN configuration', async () => {
    pveFetchMock.mockResolvedValue('UPID:apply:1')

    const res = await callRoute(applySdn, { method: 'POST', params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({ data: { upid: 'UPID:apply:1' } })
    expect(pveFetchMock).toHaveBeenCalledExactlyOnceWith(CONN, '/cluster/sdn', { method: 'PUT' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'sdn.apply', status: 'success' }))
  })
})

describe('vDC tenant SDN reads are confined to owned VNets', () => {
  beforeEach(() => {
    sdnOwnVnetsMock.mockResolvedValue(OWN)
  })

  it('filters the VNet list', async () => {
    pveFetchMock.mockResolvedValue([
      { vnet: 'vnet-own', zone: 'zone-own' },
      { vnet: 'vnet-other', zone: 'zone-other' },
      { zone: 'zone-own' },
    ])

    const res = await callRoute(getVnets, { params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({
      data: { vnets: [{ vnet: 'vnet-own', zone: 'zone-own' }] },
    })
  })

  it('keeps only zones used by an owned VNet', async () => {
    pveFetchMock.mockImplementation((_conn: unknown, path: string) => path.includes('/zones')
      ? Promise.resolve([{ zone: 'zone-own' }, { zone: 'zone-other' }])
      : Promise.resolve([
          { vnet: 'vnet-own', zone: 'zone-own' },
          { vnet: 'vnet-other', zone: 'zone-other' },
        ]))

    const res = await callRoute(getZones, { params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({ data: { zones: [{ zone: 'zone-own' }] } })
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
  })

  it('hides IPAM backends and computes pending from owned VNets and zones only', async () => {
    pveFetchMock.mockImplementation((_conn: unknown, path: string) => {
      if (path === '/version') return Promise.resolve({ release: '8.3.1' })
      if (path.includes('/zones')) {
        return Promise.resolve([
          { zone: 'zone-own' },
          { zone: 'zone-other', pending: true },
        ])
      }
      if (path.includes('/vnets')) {
        return Promise.resolve([
          { vnet: 'vnet-own', zone: 'zone-own' },
          { vnet: 'vnet-other', zone: 'zone-other', state: 'changed' },
        ])
      }
      if (path === '/cluster/sdn/ipams') return Promise.resolve([{ ipam: 'secret-backend' }])
      return Promise.resolve([])
    })

    const res = await callRoute(getStatus, { params: { id: 'conn-1' } })

    expect(await readJson(res)).toEqual({
      data: {
        version: { release: '8.3.1' },
        pveMajor: 8,
        pending: false,
        ipamBackends: [],
      },
    })
  })

  const emptyRoutes = [
    { name: 'IPAMs', handler: getIpams, params: { id: 'conn-1' }, expected: { ipams: [] } },
    {
      name: 'IPAM allocations', handler: getIpamStatus, params: { id: 'conn-1', ipam: 'pve' },
      expected: { allocations: [] },
    },
    { name: 'controllers', handler: getControllers, params: { id: 'conn-1' }, expected: { controllers: [] } },
    { name: 'DNS servers', handler: getDns, params: { id: 'conn-1' }, expected: { dns: [] } },
    { name: 'fabrics and nodes', handler: getFabrics, params: { id: 'conn-1' }, expected: { fabrics: [], nodes: [] } },
  ]

  it.each(emptyRoutes)('returns an empty $name list without calling PVE', async ({ handler, params, expected }) => {
    const res = await callRoute(handler, { params })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: expected })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('answers 404 for another tenant VNet without fetching firewall rules', async () => {
    const res = await callRoute(getFirewallRules, {
      params: { id: 'conn-1', vnet: 'vnet-other' },
    })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'VNet not found' })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns firewall rules for an owned VNet', async () => {
    const rules = [{ pos: 0, action: 'DROP' }]
    pveFetchMock.mockResolvedValue(rules)

    const res = await callRoute(getFirewallRules, {
      params: { id: 'conn-1', vnet: 'vnet-own' },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { rules } })
    expect(pveFetchMock).toHaveBeenCalledExactlyOnceWith(
      CONN,
      '/cluster/sdn/vnets/vnet-own/firewall/rules',
    )
  })

  it('refuses cluster-wide apply without issuing the PUT', async () => {
    const res = await callRoute(applySdn, { method: 'POST', params: { id: 'conn-1' } })

    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({
      error: 'Applying the cluster SDN configuration is reserved to the provider',
    })
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

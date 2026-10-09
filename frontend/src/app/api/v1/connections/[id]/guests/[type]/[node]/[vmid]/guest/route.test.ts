import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, connMock, pveFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  connMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_VIEW: 'vm.view' },
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: any[]) => connMock(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { GET } from './route'

type Responses = Record<string, unknown>

/** Route pveFetch by path suffix; an Error value is thrown. */
function pve(responses: Responses) {
  pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
    const key = Object.keys(responses).find(k => path.endsWith(k))
    if (!key) throw new Error(`unexpected ${path}`)
    const value = responses[key]
    if (value instanceof Error) throw value
    return value
  })
}

function call(params: Partial<Record<'id' | 'type' | 'node' | 'vmid', string>> = {}) {
  return callRoute(GET as any, { params: { id: 'c1', type: 'qemu', node: 'pve1', vmid: '100', ...params } })
}

async function data(res: Response) {
  return ((await readJson(res)) as any).data
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  connMock.mockReset().mockResolvedValue({ id: 'c1' })
  pveFetchMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET guests/[type]/[node]/[vmid]/guest', () => {
  it('rejects missing params', async () => {
    const res = await call({ vmid: '' })
    expect(res.status).toBe(400)
  })

  it('returns the RBAC denial', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.view', 'vm', 'c1:pve1:qemu:100')
  })

  it('combines status, IP, OS and disk usage for a running QEMU guest', async () => {
    pve({
      '/status/current': { uptime: 42, status: 'running', pid: 7 },
      '/agent/network-get-interfaces': {
        result: [
          { name: 'lo', 'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1' }] },
          { name: 'noaddr' },
          { name: 'eth0', 'ip-addresses': [{ 'ip-address-type': 'ipv6', 'ip-address': 'fe80::1' }, { 'ip-address-type': 'ipv4', 'ip-address': '10.0.0.5' }] },
        ],
      },
      '/agent/get-osinfo': { result: { id: 'debian', 'pretty-name': 'Debian 12', 'version-id': '12', 'kernel-release': '6.1' } },
      '/agent/get-fsinfo': {
        result: [
          { type: 'ext4', 'total-bytes': 100, 'used-bytes': 40, disk: [{}] },
          { type: 'tmpfs', 'total-bytes': 50, 'used-bytes': 1, disk: [{}] },
          { type: 'ntfs', 'total-bytes': 10 },
          { type: 'xfs', 'total-bytes': 0, disk: [{}] },
          { type: 'ext4', 'total-bytes': 30 },
        ],
      },
    })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await data(res)).toEqual({
      ip: '10.0.0.5', uptime: 42, status: 'running', pid: 7,
      osInfo: { type: 'linux', name: 'Debian 12', version: '12', kernel: '6.1' },
      diskUsage: { used: 40, total: 110 },
    })
  })

  it('reports a Windows guest and falls back to non-virtual filesystems without disk entries', async () => {
    pve({
      '/status/current': { status: 'running' },
      '/agent/network-get-interfaces': new Error('500 QEMU guest agent is not running'),
      '/agent/get-osinfo': { id: 'mswindows', name: 'Microsoft Windows', version: '10' },
      '/agent/get-fsinfo': { result: [{ type: 'xfs', 'total-bytes': 20 }, { type: 'proc', 'total-bytes': 5 }, { 'total-bytes': -1 }] },
    })
    const body = await data(await call())
    expect(body.ip).toBeUndefined()
    expect(body.osInfo).toEqual({ type: 'windows', name: 'Microsoft Windows', version: '10', kernel: null })
    expect(body.diskUsage).toEqual({ used: 0, total: 20 })
  })

  it('tolerates agent permission errors, empty os info and failing fsinfo', async () => {
    pve({
      '/status/current': { status: 'running' },
      '/agent/network-get-interfaces': new Error('403 Permission check failed'),
      '/agent/get-osinfo': { result: {} },
      '/agent/get-fsinfo': new Error('boom'),
    })
    const body = await data(await call())
    expect(body).toEqual({ status: 'running' })
  })

  it('returns an unknown OS type and no disk usage when every filesystem is empty', async () => {
    pve({
      '/status/current': { status: 'running' },
      '/agent/network-get-interfaces': {},
      '/agent/get-osinfo': { name: 'Plan9' },
      '/agent/get-fsinfo': { result: [{ type: 'ext4', 'total-bytes': 0 }] },
    })
    const body = await data(await call())
    expect(body.osInfo).toEqual({ type: 'other', name: 'Plan9', version: null, kernel: null })
    expect(body.diskUsage).toBeUndefined()
  })

  it('skips the agent calls for a stopped QEMU guest and survives a status error', async () => {
    pve({ '/status/current': new Error('timeout') })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await data(res)).toEqual({})
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the runtime IP and OS type of a running container', async () => {
    pve({
      '/status/current': { status: 'running', uptime: 5 },
      '/config': { ostype: 'debian', net0: 'name=eth0,ip=192.168.1.9/24' },
      '/interfaces': [{ name: 'lo', inet: '127.0.0.1/8' }, { name: 'eth1' }, { name: 'eth0', inet: '10.1.1.1/24' }],
    })
    const body = await data(await call({ type: 'lxc' }))
    expect(body.ip).toBe('10.1.1.1')
    expect(body.osInfo).toEqual({ type: 'linux', name: 'Debian', version: null, kernel: null })
  })

  it('falls back to the static container IP when the interfaces endpoint fails, skipping dhcp', async () => {
    pve({
      '/status/current': { status: 'running' },
      '/config': { ostype: 'windows-ish', net0: 'name=eth0,ip=dhcp', net1: 'name=eth1,ip=172.16.0.4/16', hostname: 'ct' },
      '/interfaces': new Error('not implemented'),
    })
    const body = await data(await call({ type: 'lxc' }))
    expect(body.ip).toBe('172.16.0.4')
    expect(body.osInfo.type).toBe('other')
  })

  it('reports no IP for a stopped container and survives a config error', async () => {
    pve({ '/status/current': { status: 'stopped' }, '/config': { net0: 'ip=10.0.0.1/24' } })
    expect(await data(await call({ type: 'lxc' }))).toEqual({ status: 'stopped' })

    pve({ '/status/current': { status: 'running' }, '/config': new Error('gone') })
    expect(await data(await call({ type: 'lxc' }))).toEqual({ status: 'running' })
  })

  it('maps a connection error to 500', async () => {
    connMock.mockRejectedValue(new Error('Connection not found'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Connection not found' })
  })
})

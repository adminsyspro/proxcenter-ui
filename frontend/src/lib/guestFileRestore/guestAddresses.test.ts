import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ isUserSuperAdmin: vi.fn() }))

import {
  SSH_HOST_NOT_GUEST_MESSAGE,
  _impl,
  assertSshHostAllowed,
  canonicalIp,
  guestAddressesFromAgent,
  guestAddressesFromLxc,
  isAllowedSshHost,
  isRoutableGuestAddress,
  listGuestAddresses,
} from './guestAddresses'

const conn = { id: 'c1', name: 'pve', baseUrl: 'https://pve:8006', apiToken: 't', insecureDev: false, behindProxy: false }
const qemu = { connId: 'c1', node: 'pve1', type: 'qemu' as const, vmid: 100 }
const lxc = { connId: 'c1', node: 'pve1', type: 'lxc' as const, vmid: 101 }
const session = { kind: 'session' as const, userId: 'u1', userEmail: 'u1@example.org', tenantId: 'default' } as any
const token = { kind: 'token' as const, tenantId: 'default' } as any

const agentAnswer = {
  result: [
    { name: 'lo', 'ip-addresses': [{ 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4' }, { 'ip-address': '::1', 'ip-address-type': 'ipv6' }] },
    {
      name: 'eth0',
      'ip-addresses': [
        { 'ip-address': '10.42.0.55', 'ip-address-type': 'ipv4', prefix: 24 },
        { 'ip-address': 'fe80::5054:ff:fe12:3456', 'ip-address-type': 'ipv6' },
        { 'ip-address': 'fd00:42::55', 'ip-address-type': 'ipv6' },
        { 'ip-address': '169.254.10.10', 'ip-address-type': 'ipv4' },
      ],
    },
  ],
}

const pveFetchMock = vi.fn()
const superAdminMock = vi.fn()

beforeEach(() => {
  pveFetchMock.mockReset()
  superAdminMock.mockReset().mockResolvedValue(false)
  _impl.pveFetch = pveFetchMock as any
  _impl.isUserSuperAdmin = superAdminMock as any
})

describe('canonicalIp / isRoutableGuestAddress', () => {
  it('normalises IPv4, bracketed and zoned IPv6, and rejects names', () => {
    expect(canonicalIp(' 10.0.0.5 ')).toBe('10.0.0.5')
    expect(canonicalIp('[FD00::5]')).toBe('fd00:0:0:0:0:0:0:5')
    expect(canonicalIp('fe80::1%eth0')).toBe('fe80:0:0:0:0:0:0:1')
    expect(canonicalIp('fd00:0000:0000:0000:0000:0000:0000:0005')).toBe('fd00:0:0:0:0:0:0:5')
    expect(canonicalIp('::ffff:10.0.0.5')).toBe('0:0:0:0:0:ffff:a00:5')
    expect(canonicalIp('vm.example.org')).toBeNull()
    expect(canonicalIp('10.0.0')).toBeNull()
  })
  it('excludes loopback, link-local and unspecified addresses', () => {
    expect(isRoutableGuestAddress('10.0.0.5')).toBe(true)
    expect(isRoutableGuestAddress('127.0.0.1')).toBe(false)
    expect(isRoutableGuestAddress('169.254.1.1')).toBe(false)
    expect(isRoutableGuestAddress('0.0.0.0')).toBe(false)
    expect(isRoutableGuestAddress('fd00:0:0:0:0:0:0:5')).toBe(true)
    expect(isRoutableGuestAddress('0:0:0:0:0:0:0:1')).toBe(false)
    expect(isRoutableGuestAddress('fe80:0:0:0:0:0:0:1')).toBe(false)
    expect(isRoutableGuestAddress('0:0:0:0:0:ffff:7f00:1')).toBe(false)
  })
})

describe('address extraction', () => {
  it('reads the guest agent answer and drops non-routable addresses', () => {
    expect(guestAddressesFromAgent(agentAnswer)).toEqual(['10.42.0.55', 'fd00:42:0:0:0:0:0:55'])
    expect(guestAddressesFromAgent(agentAnswer.result)).toEqual(['10.42.0.55', 'fd00:42:0:0:0:0:0:55'])
    expect(guestAddressesFromAgent(null)).toEqual([])
  })
  it('reads container interfaces in CIDR form', () => {
    const data = [
      { name: 'lo', inet: '127.0.0.1/8', inet6: '::1/128' },
      { name: 'eth0', hwaddr: 'aa', inet: '10.42.0.61/24', inet6: 'fe80::1/64' },
    ]
    expect(guestAddressesFromLxc(data)).toEqual(['10.42.0.61'])
  })
  it('asks the right PVE endpoint per guest type', async () => {
    pveFetchMock.mockResolvedValueOnce(agentAnswer).mockResolvedValueOnce([{ name: 'eth0', inet: '10.1.1.1/24' }])
    expect(await listGuestAddresses(conn, qemu)).toEqual(['10.42.0.55', 'fd00:42:0:0:0:0:0:55'])
    expect(pveFetchMock.mock.calls[0][1]).toBe('/nodes/pve1/qemu/100/agent/network-get-interfaces')
    expect(await listGuestAddresses(conn, lxc)).toEqual(['10.1.1.1'])
    expect(pveFetchMock.mock.calls[1][1]).toBe('/nodes/pve1/lxc/101/interfaces')
  })
})

describe('isAllowedSshHost', () => {
  it('matches canonical forms only', () => {
    const addresses = ['10.42.0.55', 'fd00:42:0:0:0:0:0:55']
    expect(isAllowedSshHost('10.42.0.55', addresses)).toBe(true)
    expect(isAllowedSshHost('[fd00:42::55]', addresses)).toBe(true)
    expect(isAllowedSshHost('10.42.0.56', addresses)).toBe(false)
    expect(isAllowedSshHost('vm.example.org', addresses)).toBe(false)
    expect(isAllowedSshHost('10.42.0.55', [])).toBe(false)
  })
})

describe('assertSshHostAllowed', () => {
  it('accepts a guest address for a regular user', async () => {
    pveFetchMock.mockResolvedValue(agentAnswer)
    expect(await assertSshHostAllowed({ conn, target: qemu, host: '10.42.0.55', principal: session })).toBeNull()
  })
  it('refuses any other host for a regular user, listing the guest addresses', async () => {
    pveFetchMock.mockResolvedValue(agentAnswer)
    const res = await assertSshHostAllowed({ conn, target: qemu, host: '10.42.0.99', principal: session })
    expect(res?.status).toBe(400)
    expect(await res!.json()).toEqual({ error: SSH_HOST_NOT_GUEST_MESSAGE, addresses: ['10.42.0.55', 'fd00:42:0:0:0:0:0:55'] })
  })
  it('refuses when the addresses cannot be resolved (agent stopped)', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 500: QEMU guest agent is not running'))
    const res = await assertSshHostAllowed({ conn, target: qemu, host: '10.42.0.55', principal: session })
    expect(res?.status).toBe(400)
    expect((await res!.json()).error).toContain('could not be resolved')
  })
  it('lets a super admin use any host without resolving the guest', async () => {
    superAdminMock.mockResolvedValue(true)
    expect(await assertSshHostAllowed({ conn, target: qemu, host: 'jump.example.org', principal: session })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(superAdminMock).toHaveBeenCalledWith('u1')
  })
  it('never treats an API token as a super admin', async () => {
    superAdminMock.mockResolvedValue(true)
    pveFetchMock.mockResolvedValue(agentAnswer)
    const res = await assertSshHostAllowed({ conn, target: qemu, host: 'jump.example.org', principal: token })
    expect(res?.status).toBe(400)
    expect(superAdminMock).not.toHaveBeenCalled()
  })
})

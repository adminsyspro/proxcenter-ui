import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import {
  SSH_HOST_NOT_GUEST_MESSAGE,
  _impl,
  assertSshHostAllowed,
  canonicalIp,
  infrastructureAddresses,
  opaqueSshErrorClass,
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
const infraHostsMock = vi.fn()
const resolveMock = vi.fn()

beforeEach(() => {
  pveFetchMock.mockReset()
  infraHostsMock.mockReset().mockResolvedValue(['10.42.0.101', 'pve2.lab.local'])
  resolveMock.mockReset().mockImplementation(async (name: string) => (name === 'pve2.lab.local' ? ['10.42.0.102'] : []))
  _impl.pveFetch = pveFetchMock as any
  _impl.infrastructureHosts = infraHostsMock as any
  _impl.resolve = resolveMock as any
  _impl.localAddresses = () => ['127.0.0.1', '10.42.0.5']
})

describe('canonicalIp / isRoutableGuestAddress', () => {
  it('normalises IPv4, bracketed and zoned IPv6, and rejects names', () => {
    expect(canonicalIp(' 10.0.0.5 ')).toBe('10.0.0.5')
    expect(canonicalIp('[FD00::5]')).toBe('fd00:0:0:0:0:0:0:5')
    expect(canonicalIp('fe80::1%eth0')).toBe('fe80:0:0:0:0:0:0:1')
    expect(canonicalIp('fd00:0000:0000:0000:0000:0000:0000:0005')).toBe('fd00:0:0:0:0:0:0:5')
    expect(canonicalIp('::ffff:10.0.0.5')).toBe('10.0.0.5')
    expect(canonicalIp('::ffff:a2a:65')).toBe('10.42.0.101')
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
    expect(isRoutableGuestAddress(canonicalIp('::ffff:127.0.0.1')!)).toBe(false)
    expect(isRoutableGuestAddress(canonicalIp('::ffff:169.254.1.1')!)).toBe(false)
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
  const tenant = { conn, target: qemu, principal: session, providerCaller: false }

  it('accepts a guest address for a tenant caller', async () => {
    pveFetchMock.mockResolvedValue(agentAnswer)
    expect(await assertSshHostAllowed({ ...tenant, host: '10.42.0.55' })).toBeNull()
  })
  it('refuses any other host for a tenant caller, listing the guest addresses', async () => {
    pveFetchMock.mockResolvedValue(agentAnswer)
    const res = await assertSshHostAllowed({ ...tenant, host: '10.42.0.99' })
    expect(res?.status).toBe(400)
    expect(await res!.json()).toEqual({ error: SSH_HOST_NOT_GUEST_MESSAGE, addresses: ['10.42.0.55', 'fd00:42:0:0:0:0:0:55'] })
  })
  it('refuses when the addresses cannot be resolved (agent stopped)', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 500: QEMU guest agent is not running'))
    const res = await assertSshHostAllowed({ ...tenant, host: '10.42.0.55' })
    expect(res?.status).toBe(400)
    expect((await res!.json()).error).toContain('could not be resolved')
  })
  // A tenant is root in its guest: its agent can claim a PVE node's address.
  it('refuses an infrastructure address the guest claims as its own, with the same answer', async () => {
    pveFetchMock.mockResolvedValue({ result: [{ name: 'eth0', 'ip-addresses': [
      { 'ip-address': '10.42.0.55' }, { 'ip-address': '10.42.0.101' }, { 'ip-address': '10.42.0.102' }, { 'ip-address': '10.42.0.5' },
    ] }] })
    for (const host of ['10.42.0.101', '10.42.0.102', '10.42.0.5']) {
      const res = await assertSshHostAllowed({ ...tenant, host })
      expect(res?.status, host).toBe(400)
      expect(await res!.json(), host).toEqual({ error: SSH_HOST_NOT_GUEST_MESSAGE, addresses: ['10.42.0.55'] })
    }
    expect(await assertSshHostAllowed({ ...tenant, host: '10.42.0.55' })).toBeNull()
  })
  it('refuses an infrastructure address written as IPv4-mapped IPv6', async () => {
    pveFetchMock.mockResolvedValue({ result: [{ name: 'eth0', 'ip-addresses': [{ 'ip-address': '::ffff:10.42.0.101' }, { 'ip-address': '10.42.0.55' }] }] })
    for (const host of ['::ffff:10.42.0.101', '[::ffff:a2a:65]']) {
      expect((await assertSshHostAllowed({ ...tenant, host }))?.status, host).toBe(400)
    }
  })
  it('lets a provider caller use any host without resolving anything', async () => {
    expect(await assertSshHostAllowed({ ...tenant, providerCaller: true, host: 'jump.example.org' })).toBeNull()
    expect(await assertSshHostAllowed({ ...tenant, providerCaller: true, host: '10.42.0.101' })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(infraHostsMock).not.toHaveBeenCalled()
  })
  it('never treats an API token as a provider caller', async () => {
    pveFetchMock.mockResolvedValue(agentAnswer)
    const res = await assertSshHostAllowed({ ...tenant, providerCaller: true, principal: token, host: 'jump.example.org' })
    expect(res?.status).toBe(400)
  })
})

describe('infrastructureAddresses', () => {
  it('collects IPs, resolved host names and local interfaces, canonicalised', async () => {
    infraHostsMock.mockResolvedValue(['10.42.0.101', 'pve2.lab.local', '[fd00::1]', 'unknown.invalid'])
    const set = await infrastructureAddresses()
    expect([...set].sort()).toEqual(['10.42.0.101', '10.42.0.102', '10.42.0.5', '127.0.0.1', 'fd00:0:0:0:0:0:0:1'].sort())
  })
})

describe('opaqueSshErrorClass', () => {
  it('hides the network causes, keeps authentication and host key answers', () => {
    for (const c of ['unreachable', 'timeout', 'error']) expect(opaqueSshErrorClass(c)).toBe(true)
    for (const c of ['auth_failed', 'host_key', 'unsupported_os', undefined]) expect(opaqueSshErrorClass(c)).toBe(false)
  })
})

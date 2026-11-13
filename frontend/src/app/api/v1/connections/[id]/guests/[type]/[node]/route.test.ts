import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getRequestGuestScopePerimeterMock = vi.fn<(...args: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRequestGuestScopePerimeter: getRequestGuestScopePerimeterMock,
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  PERMISSIONS: { VM_CREATE: 'vm.create', VM_CONFIG_HARDWARE: 'vm.config.hardware', STORAGE_CONTENT: 'storage.content' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({ resolveVdcForTenant: vi.fn(async () => null), checkVdcQuota: vi.fn() }))
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))
const getAllowedNetworksForTenantMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/vdc/vnets', async (io) => {
  // The verdict logic is what this file exercises, so it runs for real; only
  // the DB-backed allow-list lookup is stubbed.
  const actual = await io<typeof import('@/lib/vdc/vnets')>()
  return {
    getAllowedNetworksForTenant: getAllowedNetworksForTenantMock,
    validateNetAgainstScope: actual.validateNetAgainstScope,
    resolveSubnetForBridge: vi.fn(async () => null),
    parseBridgeFromNet: (net: string) => /(?:^|,)bridge=([^,]+)/.exec(net)?.[1] ?? null,
  }
})
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/vdc/ipam', () => ({ allocateIp: vi.fn(), allocateIpTracked: vi.fn(), releaseIp: vi.fn(), IpamExhaustedError: class extends Error {} }))
vi.mock('@/lib/vdc/network', () => ({ parseCidr: () => null }))
const enforceGuestTagAccessMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
vi.mock('@/lib/proxmox/tagAccessServer', () => ({ enforceGuestTagAccess: enforceGuestTagAccessMock }))
const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve1' }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getRequestGuestScopePerimeterMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset().mockResolvedValue('UPID:x')
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
  getAllowedNetworksForTenantMock.mockReset().mockResolvedValue(null)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  enforceGuestTagAccessMock.mockReset().mockResolvedValue(null)
})

describe('POST guests create — MSP VMID range enforcement', () => {
  it('ok: creates the guest and checks the range with the parsed vmid', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
  })

  it('400: rejected by range check, PVE create never called', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('tenant range')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('409: already in use, PVE create never called', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 409, error: 'VMID 190 is already in use in your infrastructure' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(409)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('enforces the same range check for lxc containers', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: { ...baseParams, type: 'lxc' }, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe('POST guests create: flat-scoped pool containment', () => {
  function restrictedTo(pools: string[]) {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    getRequestGuestScopePerimeterMock.mockResolvedValue({
      restricted: true,
      holdsPermission: true,
      hasVisibleGuests: true,
      pools: new Set(pools),
      nodes: new Set(['pve1']),
    })
  }

  function createdBody() {
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()

    return JSON.parse(String(createCall![2].body))
  }

  it('injects the only accessible pool when the body carries none', async () => {
    restrictedTo(['p1'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(createdBody().pool).toBe('p1')
  })

  it('403: rejects a pool outside the caller scope, PVE create never called', async () => {
    restrictedTo(['p1'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, pool: 'other' } })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('Resource pool outside your scope')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('400: asks for a pool when several are accessible and none was chosen', async () => {
    restrictedTo(['p1', 'p2'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('A resource pool within your scope is required')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('lets through a pool that belongs to the caller scope', async () => {
    restrictedTo(['p1', 'p2'])
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, pool: 'p2' } })
    expect(res.status).toBe(200)
    expect(createdBody().pool).toBe('p2')
  })

  it('leaves the body untouched for a connection-scoped creator', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(createdBody().pool).toBeUndefined()
    // No fallback needed, so the perimeter is never resolved.
    expect(getRequestGuestScopePerimeterMock).not.toHaveBeenCalled()
  })
})

describe('POST guests create: vDC network allow-list', () => {
  /** vmbr0 is shared with a 100-199 pool; vnetacme is an SDN vnet. */
  const scoped = () =>
    new Map([
      ['vmbr0', { kind: 'shared' as const, vlanRanges: [{ start: 100, end: 199 }] }],
      ['vnetacme', { kind: 'vnet' as const, vlanRanges: [] }],
    ])

  it('403: a VLAN tag outside the vDC pools never reaches PVE', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vmbr0,tag=250' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain("outside your vDC's VLAN pools")
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: a tag on an SDN vnet is refused', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vnetacme,tag=150' },
    })
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200: a tag inside the vDC pools is accepted', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vmbr0,tag=150' },
    })
    expect(res.status).toBe(200)
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
  })

  it('403: an unknown bridge is still refused', async () => {
    getAllowedNetworksForTenantMock.mockResolvedValue(scoped())
    const POST = await loadPost()
    const res = await callRoute(POST, {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio,bridge=vmbr42' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('is not authorized')
  })
})


describe('POST guests: explicit tenant NIC identity', () => {
  for (const net0 of ['virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0', 'virtio,bridge=vmbr0,tag=100', 'virtio,bridge=vmbr0,trunks=100;101']) {
    it(`requires a separate right for ${net0}`, async () => {
      checkPermissionMock.mockImplementation(async permission => permission === 'vm.create' ? null : Response.json({ error: 'denied' }, { status: 403 }))
      const res = await callRoute(await loadPost(), { params: baseParams, body: { vmid: 190, net0 } })
      expect(res.status).toBe(403)
      expect(pveFetchMock).not.toHaveBeenCalled()
    })
  }
  it('allows PVE to generate a MAC without an identity grant', async () => {
    checkPermissionMock.mockImplementation(async permission => permission === 'vm.create' ? null : Response.json({ error: 'denied' }, { status: 403 }))
    const res = await callRoute(await loadPost(), { params: baseParams, body: { vmid: 190, net0: 'virtio,bridge=vmbr0' } })
    expect(res.status).toBe(200)
  })
})

describe('POST guests create: IPAM rollback on a failed PVE create', () => {
  const subnet = { vdcId: 'vdc-1', vnetId: 'vnet-1', subnetId: 'subnet-1', cidr: '10.42.0.0/24', gateway: '10.42.0.254', dnsServers: [] }

  async function failCreate(created: boolean) {
    const { resolveSubnetForBridge } = await import('@/lib/vdc/vnets')
    const { allocateIpTracked, releaseIp } = await import('@/lib/vdc/ipam')
    vi.mocked(resolveSubnetForBridge).mockImplementation(async (_c: string, bridge: string) => (bridge === 'tenantA' ? subnet : null) as any)
    vi.mocked(allocateIpTracked).mockResolvedValue({ allocation: { ip: '10.42.0.7' } as any, created })
    vi.mocked(releaseIp).mockReset()
    pveFetchMock.mockRejectedValue(new Error('vmid 190 already exists'))
    const res = await callRoute(await loadPost(), {
      params: baseParams,
      body: { vmid: 190, net0: 'virtio=AA:BB:CC:DD:EE:01,bridge=tenantA' },
    })
    vi.mocked(resolveSubnetForBridge).mockImplementation(async () => null)
    return { res, releaseIp: vi.mocked(releaseIp) }
  }

  it('keeps the reservation a pinned MAC already held', async () => {
    const { res, releaseIp } = await failCreate(false)
    expect(res.status).toBe(500)
    expect(releaseIp).not.toHaveBeenCalled()
  })

  it('releases the reservation this request inserted', async () => {
    const { res, releaseIp } = await failCreate(true)
    expect(res.status).toBe(500)
    expect(releaseIp).toHaveBeenCalledWith({ subnetId: 'subnet-1', ip: '10.42.0.7' })
  })
})

describe('POST guests create — cluster outside the license (roadmap#58)', () => {
  it('answers 403 with its code when the create write is refused', async () => {
    const { PveLicenseExcludedError } = await import('@/lib/license/exclusions')
    pveFetchMock.mockRejectedValue(new PveLicenseExcludedError('conn-1'))
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'CONNECTION_LICENSE_EXCLUDED' })
  })
})

describe('POST guests create: datacenter User Tag Access (#1208)', () => {
  const pveCreateCalled = () => pveFetchMock.mock.calls.some(c => c[2]?.method === 'POST')

  it('checks the tags of the new guest against an empty set', async () => {
    const res = await callRoute(await loadPost(), { params: baseParams, body: { vmid: 190, tags: 'web;db' } })

    expect(res.status).toBe(200)
    expect(enforceGuestTagAccessMock).toHaveBeenCalledWith({ connId: 'conn-1', conn: { id: 'conn-1' }, oldTags: '', newTags: 'web;db' })
  })

  it('answers the refusal before PVE creates anything', async () => {
    enforceGuestTagAccessMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))
    const res = await callRoute(await loadPost(), { params: baseParams, body: { vmid: 190, tags: 'nope' } })

    expect(res.status).toBe(403)
    expect(pveCreateCalled()).toBe(false)
  })
})

describe('POST guests create: tenant LXC is forced unprivileged', () => {
  async function withVdc() {
    const quota = await import('@/lib/vdc/quota')
    vi.mocked(quota.resolveVdcForTenant).mockResolvedValue({
      allowBlankVms: true,
      poolName: 'vdc-pool',
      quota: null,
      computePolicy: null,
      storagePolicies: new Map(),
    } as any)
    vi.mocked(quota.checkVdcQuota).mockResolvedValue({ ok: true } as any)
  }

  it('refuses an explicitly privileged container', async () => {
    await withVdc()
    const res = await callRoute(await loadPost(), {
      params: { ...baseParams, type: 'lxc' },
      body: { vmid: 190, unprivileged: 0, ostemplate: 'local:vztmpl/x.tar.zst', rootfs: 'ceph:2' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('unprivileged')
    expect(pveFetchMock.mock.calls.some(c => c[2]?.method === 'POST')).toBe(false)
  })

})

describe('POST guests create: tenant restore via create is refused', () => {
  it('403: an archive= on the create route is pushed to the restore endpoint', async () => {
    const res = await callRoute(await loadPost(), {
      params: baseParams,
      body: { vmid: 190, archive: 'pbs:backup/vm/100/2026-01-01T00:00:00Z', storage: 'ceph' },
    })
    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('restore endpoint')
    expect(pveFetchMock.mock.calls.some(c => c[2]?.method === 'POST')).toBe(false)
  })
})

describe('POST guests create: restores and volumes of another guest, for every caller (roadmap#219)', () => {
  const created = () => pveFetchMock.mock.calls.find(c => /^\/nodes\/pve1\/(qemu|lxc)$/.test(String(c[1])) && c[2]?.method === 'POST')
  const lxc = { ...baseParams, type: 'lxc' }

  beforeEach(async () => {
    // Earlier suites leave a vDC resolved: these cases are a provider's.
    vi.mocked((await import('@/lib/vdc/quota')).resolveVdcForTenant).mockResolvedValue(null as any)
  })

  it.each([
    ['qemu archive', baseParams, { vmid: 190, archive: 'local:backup/vzdump-qemu-200-2026_01_01-00_00_00.vma.zst' }],
    ['lxc archive', lxc, { vmid: 190, archive: 'local:backup/vzdump-lxc-300-2026_01_01-00_00_00.tar.zst' }],
    ['lxc restore flag', lxc, { vmid: 190, ostemplate: 'local:vztmpl/debian-13.tar.zst', restore: 1 }],
    ['lxc restore flag as text', lxc, { vmid: 190, ostemplate: 'pbs:backup/ct/300/2026-01-01T00:00:00Z', restore: 'true' }],
    ['lxc backup as template', lxc, { vmid: 190, ostemplate: 'local:backup/vzdump-lxc-300-2026_01_01-00_00_00.tar.zst' }],
    ['lxc PBS backup as template', lxc, { vmid: 190, ostemplate: 'pbs:backup/ct/300/2026-01-01T00:00:00Z' }],
  ])('403: %s is a restore, sent to the restore endpoint whoever asks', async (_label, params, body) => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params, body })

    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toEqual({ error: 'Restoring from a backup must go through the restore endpoint.' })
    expect(created()).toBeUndefined()
  })

  it('200: a container from a template, restore unset or off', async () => {
    const POST = await loadPost()

    for (const body of [{ vmid: 190, ostemplate: 'local:vztmpl/debian-13-standard_13.6-1_amd64.tar.zst' }, { vmid: 191, ostemplate: 'ISO:vztmpl/alpine.tar.xz', restore: 0 }]) {
      pveFetchMock.mockClear()
      const res = await callRoute(POST, { params: lxc, body })

      expect(res.status, JSON.stringify(body)).toBe(200)
      expect(created()).toBeDefined()
    }
  })

  it.each(['ceph:vm-200-disk-0', 'nfs:200/vm-200-disk-0.raw', 'local:iso/x.iso', '/var/lib/vz/template/cache/x.tar.zst', 'local:vztmpl/../x', ''])(
    '400: a container template that is not a template of a storage (%s)',
    async ostemplate => {
      const POST = await loadPost()
      const res = await callRoute(POST, { params: lxc, body: { vmid: 190, ostemplate } })

      expect(res.status).toBe(400)
      expect((await readJson<any>(res)).error).toMatch(/^ostemplate: expected a container template/)
      expect(created()).toBeUndefined()
    },
  )

  it('403: importing the disk of a guest the creator may not reconfigure, nothing created', async () => {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => (String(path).startsWith('/cluster/resources') ? [{ vmid: 200, node: 'pve2', type: 'qemu' }] : 'UPID:x'))
    checkPermissionMock.mockImplementation(async (permission: string) =>
      permission === 'vm.config.hardware' ? deniedPermissionResponse('vm.config.hardware') : null)
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, scsi0: 'ceph:0,import-from=ceph:vm-200-disk-0' } })

    expect(res.status).toBe(403)
    expect((await readJson<any>(res)).error).toMatch(/^scsi0: this volume is not one of this guest's disks/)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'vm', 'conn-1:pve2:qemu:200')
    expect(created()).toBeUndefined()
  })

  it('200: a new disk, an ISO and an image of an import storage ask nothing more', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, scsi0: 'ceph:32', scsi1: 'ceph:0,import-from=local:import/debian-12.qcow2', ide2: 'local:iso/debian-13.iso,media=cdrom' } })

    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).startsWith('/cluster/resources'))).toBe(false)
    expect(created()).toBeDefined()
  })

  it('403: cicustom on a storage the creator holds no content right on', async () => {
    checkPermissionMock.mockImplementation(async (permission: string) =>
      permission === 'storage.content' ? deniedPermissionResponse('storage.content') : null)
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190, cicustom: 'user=local:snippets/user.yaml' } })

    expect(res.status).toBe(403)
    expect(created()).toBeUndefined()
  })
})

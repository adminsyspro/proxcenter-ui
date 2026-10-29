import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'

const demoGet = async (path: string, method = 'GET'): Promise<any> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`, { method }))

    return res ? await res.json() : null
  } finally {
    process.env.DEMO_MODE = prev
  }
}

const VDCS = ['demo-vdc-acme-prod', 'demo-vdc-acme-dr', 'demo-vdc-globex-prod', 'demo-vdc-initech-prod']

describe('demo settings mocks: connections', () => {
  it('filters admin connections by type', async () => {
    const pve = await demoGet('/api/v1/admin/connections?type=pve')
    const pbs = await demoGet('/api/v1/admin/connections?type=pbs')

    expect(pve.data.map((c: any) => c.id)).toEqual(['demo-pve-cluster-001', 'demo-pve-dr-001'])
    expect(pbs.data.every((c: any) => c.type === 'pbs')).toBe(true)
    expect(pbs.data.map((c: any) => c.id)).toContain('demo-pbs-paris-001')
  })

  it('serves available resources with nodes, storages and pools', async () => {
    const j = await demoGet('/api/v1/admin/connections/demo-pve-cluster-001/available-resources?vdcId=demo-vdc-acme-prod')

    expect(j.data.nodes).toHaveLength(12)
    expect(j.data.nodes[0]).toMatchObject({ name: 'pve-node-01', status: 'online' })
    expect(j.data.storages.map((s: any) => s.id)).toContain('ceph-block')
    expect(j.data.pools).toContain('vdc-acme-acme-prod')
  })

  it('serves green config, node addresses, provider bridges and storage policies', async () => {
    const green = await demoGet('/api/v1/admin/connections/demo-pve-cluster-001/green-config')

    expect(green.data.cluster.datacenterId).toBe('demo-dc-paris')
    expect(green.data.nodes.find((n: any) => n.nodeName === 'pve-node-04').datacenterId).toBe('demo-dc-frankfurt')

    const addr = await demoGet('/api/v1/admin/connections/demo-pve-dr-001/node-addresses')

    expect(addr.data.nodes[0]).toMatchObject({ name: 'pve-dr-01', online: true })
    expect(Array.isArray(addr.data.devices)).toBe(true)

    const bridges = await demoGet('/api/v1/admin/connections/demo-pve-cluster-001/provider-bridges?scope=vlan-pool')

    expect(bridges.data.every((b: any) => b.vlanAware)).toBe(true)

    const policies = await demoGet('/api/v1/admin/connections/demo-pve-cluster-001/storage-policies')

    expect(policies.data.length).toBeGreaterThan(0)

    const disks = await demoGet(`/api/v1/admin/connections/demo-pve-cluster-001/storage-policies/${policies.data[0].id}/disks`)

    expect(Array.isArray(disks.data.vms)).toBe(true)
    expect(disks.data.vms[0].disks[0]).toHaveProperty('inSync')
  })
})

describe('demo settings mocks: vDC detail endpoints', () => {
  it('serves zone and transport status for every vDC', async () => {
    for (const id of VDCS) {
      const zone = await demoGet(`/api/v1/admin/vdcs/${id}/zone`)
      const transport = await demoGet(`/api/v1/admin/vdcs/${id}/transport/provision`)

      expect(zone.data.inSync).toBe(true)
      expect(zone.data.desired.peers.length).toBeGreaterThan(0)
      expect(Array.isArray(transport.data.nodes)).toBe(true)
    }
  })

  it('serves a usage history curve, admin and tenant side', async () => {
    const to = Date.now()
    const qs = `from=${new Date(to - 7 * 86400000).toISOString()}&to=${new Date(to).toISOString()}&bucket=hour`

    for (const base of ['/api/v1/admin/vdcs', '/api/v1/vdcs']) {
      const j = await demoGet(`${base}/demo-vdc-acme-prod/usage/history?${qs}`)

      expect(j.data.enabled).toBe(true)
      expect(j.data.periods.length).toBeGreaterThan(100)
      expect(j.data.periods[0].counters.usedVcpus).toHaveProperty('max')
    }

    const year = await demoGet('/api/v1/vdcs/demo-vdc-globex-prod/usage/history?bucket=month&from=2025-11-01T00:00:00.000Z')

    expect(year.data.periods.length).toBeGreaterThanOrEqual(12)
  })

  it('lists a deleted vDC whose history still answers', async () => {
    const list = await demoGet('/api/v1/admin/vdc-usage-history/deleted')
    const gone = list.data[0]
    const j = await demoGet(`/api/v1/admin/vdcs/${gone.vdcId}/usage/history?bucket=day&from=2026-08-01T00:00:00.000Z&to=2026-09-01T00:00:00.000Z`)

    expect(j.data.deleted).toBe(true)
    expect(j.data.periods.length).toBeGreaterThan(20)
  })

  it('serves the history sampler settings and status', async () => {
    const j = await demoGet('/api/v1/settings/vdc-usage-history')

    expect(j.data.enabled).toBe(true)
    expect(j.status.samplerActive).toBe(true)
  })

  it('serves the tenant green card, vnet detail, IPAM and next free IP', async () => {
    const green = await demoGet('/api/v1/vdcs/demo-vdc-acme-prod/green')

    expect(green.data.power.current).toBeGreaterThan(0)
    expect(green.data.efficiency).toHaveProperty('score')
    expect(green.data).not.toHaveProperty('cost')

    const vnet = await demoGet('/api/v1/vdcs/demo-vdc-acme-prod/vnets/Web%20tier')

    expect(vnet.data.pveName).toBe('a1b2c3d4')

    const ipam = await demoGet('/api/v1/vdcs/demo-vdc-acme-prod/vnets/Web%20tier/ipam')

    expect(ipam.data.allocations.length).toBe(ipam.data.used)
    expect(ipam.data.allocations[0].vm).toHaveProperty('status')

    const next = await demoGet('/api/v1/vdcs/demo-vdc-acme-prod/vnets/Web%20tier/ipam/next-free')

    expect(next.data.ip).toMatch(/^10\.100\.10\.\d+$/)
    expect(next.data.prefix).toBe(24)
  })
})

describe('demo settings mocks: security and compliance', () => {
  it('lists admin sessions with exactly one current row', async () => {
    const j = await demoGet('/api/v1/admin/sessions')

    expect(j.truncated).toBe(false)
    expect(j.data.filter((s: any) => s.current)).toHaveLength(1)
    expect(j.data[0]).toHaveProperty('browser')
  })

  it('serves audit retention, OIDC logout and lockouts', async () => {
    expect((await demoGet('/api/v1/audit/retention')).data).toEqual({ autoCleanup: true, retentionDays: 365 })
    expect((await demoGet('/api/v1/auth/oidc/logout-url')).url).toBeNull()

    const locks = await demoGet('/api/v1/compliance/login-lockouts')

    expect(locks.data.every((l: any) => Date.parse(l.lockedUntil) > Date.now())).toBe(true)
  })

  it('assesses every framework for both clusters', async () => {
    for (const conn of ['demo-pve-cluster-001', 'demo-pve-dr-001']) {
      const j = await demoGet(`/api/v1/compliance/frameworks?connectionId=${conn}`)

      expect(j.data.length).toBeGreaterThan(0)
      expect(j.data[0]).toHaveProperty('controls')
      expect(j.data.some((a: any) => a.assessedControls > 0)).toBe(true)
      expect(j.nodes.length).toBeGreaterThan(1)
    }
  })

  it('serves the compliance profile detail with snake_case checks', async () => {
    const j = await demoGet('/api/v1/compliance/profiles/prof-001')

    expect(j.data.is_active).toBe(1)
    expect(j.data.checks[0]).toMatchObject({ profile_id: 'prof-001', enabled: 1 })
  })

  it('serves user, tenant and assignment details for the list ids', async () => {
    expect((await demoGet('/api/v1/users/demo-user-003')).data.email).toBe('bob@acme.example')
    expect((await demoGet('/api/v1/tenants/demo-tenant-acme')).data.slug).toBe('acme')
    expect((await demoGet('/api/v1/rbac/assignments/demo-asg-006')).data.role_id).toBe('role_tenant_admin')

    const members = await demoGet('/api/v1/tenants/demo-tenant-acme/users')

    expect(members.data.map((u: any) => u.id)).toEqual(expect.arrayContaining(['demo-user-001', 'demo-user-003', 'demo-user-004']))
    expect(members.data.find((u: any) => u.id === 'demo-user-003').rbac_roles[0].id).toBe('role_tenant_admin')
  })

  it('never exposes a token secret', async () => {
    const list = await demoGet('/api/v1/settings/api-tokens')
    const mine = await demoGet('/api/v1/users/demo-user-001/api-tokens')

    expect(list.data[0].tenant.name).toBeTruthy()
    expect(JSON.stringify(list)).not.toMatch(/secret|hash/i)
    expect(list.data.every((t: any) => /^pxc_[0-9a-f]{8}$/.test(t.tokenPrefix))).toBe(true)
    expect(mine.data.every((t: any) => t.token_prefix && !('revokedAt' in t))).toBe(true)
    expect((await demoGet('/api/v1/settings/api-tokens/grantable-scopes')).data.grantable).toContain('vms:read')
  })
})

describe('demo settings mocks: settings tabs', () => {
  it('lists tenant networks, filtered by tenant', async () => {
    const all = await demoGet('/api/v1/admin/tenant-networks')
    const acme = await demoGet('/api/v1/admin/tenant-networks?tenantId=demo-tenant-acme')

    expect(all.data.length).toBe(3)
    expect(acme.data.every((n: any) => n.tenantId === 'demo-tenant-acme')).toBe(true)
    expect(Array.isArray(acme.data[0].members)).toBe(true)
    expect((await demoGet(`/api/v1/admin/tenant-networks/${acme.data[0].id}`)).data.vni).toBe(acme.data[0].vni)
  })

  it('reports a healthy HA cluster so the navbar badge stays green', async () => {
    const j = await demoGet('/api/v1/ha/cluster')
    const members = j.patroni.members

    expect(members.filter((m: any) => m.state === 'running')).toHaveLength(members.length)
    expect(j.etcd.healthy).toBe(true)
  })

  it('serves license imports and refuses the request download', async () => {
    const j = await demoGet('/api/v1/license/imports')

    expect(j.imports.map((i: any) => i.type)).toEqual(['option', 'edition'])

    const prev = process.env.DEMO_MODE

    process.env.DEMO_MODE = 'true'
    try {
      const res: any = await demoResponse(new Request('http://localhost/api/v1/license/request'))

      expect(res.status).toBe(403)
    } finally {
      process.env.DEMO_MODE = prev
    }
  })

  it('serves TLS, SSH, broadcast and tab settings in the shapes the tabs read', async () => {
    const tls = await demoGet('/api/v1/settings/tls')

    expect(tls.settings.source).toBe('acme')
    expect(tls.active.isActive).toBe(true)
    expect((await demoGet('/api/v1/settings/tls/certificates')).certificates.length).toBeGreaterThan(1)

    const allow = await demoGet('/api/v1/ssh/allowlist')

    expect(allow.categories[0].commands[0]).toHaveProperty('usedBy')
    expect((await demoGet('/api/v1/ssh/host-keys')).hosts.length).toBe(16)

    const bc = await demoGet('/api/v1/settings/broadcast')

    expect(bc.data.every((b: any) => !b.enabled || Date.parse(b.startsAt) > Date.now() || Date.parse(b.endsAt) < Date.now())).toBe(true)
    expect((await demoGet('/api/v1/settings/guest-file-restore')).data.agentEnabled).toBe(true)
    expect((await demoGet('/api/v1/settings/map')).data.provider).toBe('osm')
    expect((await demoGet('/api/v1/settings/reports-template')).primaryColor).toBe('#0f766e')
    expect((await demoGet('/api/v1/settings/login-background')).imageUrl).toBeNull()
    expect((await demoGet('/api/v1/settings/appearance')).stored).toBe(false)
  })
})

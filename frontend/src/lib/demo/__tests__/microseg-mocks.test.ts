import { describe, it, expect } from 'vitest'

import { demoResponse } from '../demo-api'

const BASE = '/api/v1/firewall/microseg/demo-pve-cluster-001'

const demo = async (path: string, method = 'GET'): Promise<{ status: number; body: any }> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`, { method }))

    return { status: res!.status, body: await res!.json() }
  } finally {
    process.env.DEMO_MODE = prev
  }
}

const demoGet = async (path: string) => (await demo(path)).body

describe('demo micro-segmentation', () => {
  it('serves the demo policy, status and suggestions for the demo connection', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const status = await demoGet(`${BASE}/status`)
    const suggestions = await demoGet(`${BASE}/suggestions`)

    expect(policy.zones.length).toBeGreaterThanOrEqual(4)
    expect(policy.zones.length).toBeLessThanOrEqual(5)
    expect(policy.flows.length).toBeGreaterThanOrEqual(3)
    expect(policy.policy.tag_prefix).toBe('zone-')
    expect(status.engine.held).toBe(false)
    expect(status.emergency_stop).toBe(false)
    expect(suggestions.suggestions.map((s: any) => s.kind).sort((a: string, b: string) => a.localeCompare(b))).toContain('would_block')
    expect(suggestions.suggestions.map((s: any) => s.kind)).toContain('blocked')
  })

  it('answers any connection id, as the demo has one cluster', async () => {
    const policy = await demoGet('/api/v1/firewall/microseg/some-other-id/policy')

    expect(policy.zones.length).toBeGreaterThan(0)
  })

  it('keeps the policy consistent: flows and revisions point at real zones, nothing is pending, the version matches its revision', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const ids = new Set(policy.zones.map((z: any) => z.id))

    for (const f of policy.flows) {
      expect(f.src_zone_id === '' ? f.src_cidr !== '' : ids.has(f.src_zone_id), f.id).toBe(true)
      expect(ids.has(f.dst_zone_id), f.id).toBe(true)
    }

    expect(policy.pending_changes).toBe(false)
    expect(policy.pending_members).toEqual([])
    expect(policy.last_revision.version).toBe(policy.version)
    expect(policy.last_revision).not.toHaveProperty('snapshot')
    expect(new Set(policy.zones.map((z: any) => z.name)).size).toBe(policy.zones.length)
    expect(policy.zones.map((z: any) => z.state)).toEqual(expect.arrayContaining(['enforce', 'observe']))
  })

  it('tags the members of every zone in the demo inventory, with an address, as the map reads them', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const { data } = await demoGet('/api/v1/vms?connId=demo-pve-cluster-001')
    const tagged = new Map<string, any[]>()

    for (const vm of data.vms) {
      for (const tag of vm.tags ?? []) {
        if (String(tag).startsWith(policy.policy.tag_prefix)) tagged.set(tag, [...(tagged.get(tag) ?? []), vm])
      }
    }

    for (const z of policy.zones) {
      const members = tagged.get(`${policy.policy.tag_prefix}${z.name}`) ?? []

      expect(members.length, z.name).toBeGreaterThan(0)
      for (const vm of members) expect(vm.ips?.length, `${z.name}/${vm.vmid}`).toBeGreaterThan(0)
    }

    const bare = data.vms.find((vm: any) => vm.vmid === 100)

    expect(bare.tags).toContain('MASTER')
    expect(bare.tags).toContain('zone-web')
    expect(data.vms.some((vm: any) => (vm.tags ?? []).length === 0 && !vm.ips)).toBe(true)
  })

  it('reports a status that adds up with the zones and their members', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const status = await demoGet(`${BASE}/status`)
    const { data } = await demoGet('/api/v1/vms?connId=demo-pve-cluster-001')
    const members = data.vms.filter((vm: any) => (vm.tags ?? []).some((t: string) => t.startsWith('zone-') && policy.zones.some((z: any) => `zone-${z.name}` === t)))
    const states = policy.zones.reduce((acc: Record<string, number>, z: any) => ({ ...acc, [z.state]: (acc[z.state] ?? 0) + 1 }), {})

    expect(status.coverage.members).toBe(members.length)
    expect(status.coverage.zoned).toBe(members.length)
    expect(status.coverage.protected).toBeLessThanOrEqual(status.coverage.members)
    expect(status.coverage.running).toBeGreaterThanOrEqual(status.coverage.zoned)
    expect(status.zones_by_state).toEqual({ disabled: 0, observe: 0, enforce: 0, ...states })
    expect(Object.keys(status.engine.last_runs).length).toBeGreaterThan(0)
  })

  it('serves observed flows that name zones and addresses of the map', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const ids = new Set(policy.zones.map((z: any) => z.id))
    const { suggestions } = await demoGet(`${BASE}/suggestions?direction=in`)

    expect(suggestions.length).toBeGreaterThanOrEqual(4)

    for (const s of suggestions) {
      expect(ids.has(s.dst_zone_id), s.id).toBe(true)
      expect(s.src_zone_id === '' || ids.has(s.src_zone_id), s.id).toBe(true)
      expect(s.src_key, s.id).toBe(s.src_zone_id || s.src_ip)
      expect(Date.parse(s.last_seen)).toBeGreaterThanOrEqual(Date.parse(s.first_seen))
      expect(Date.parse(s.last_seen)).toBeLessThanOrEqual(Date.now())
    }
  })

  it('filters the suggestions by kind, status and zone, and pages them', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const all = (await demoGet(`${BASE}/suggestions`)).suggestions
    const blocked = (await demoGet(`${BASE}/suggestions?kind=blocked`)).suggestions
    const pending = (await demoGet(`${BASE}/suggestions?status=pending`)).suggestions
    const dismissed = (await demoGet(`${BASE}/suggestions?status=dismissed`)).suggestions
    const web = policy.zones.find((z: any) => z.name === 'web').id
    const ofWeb = (await demoGet(`${BASE}/suggestions?zone=${web}`)).suggestions
    const first = await demoGet(`${BASE}/suggestions?limit=2&offset=1`)

    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((s: any) => s.kind === 'blocked')).toBe(true)
    expect(pending.every((s: any) => s.status === 'pending')).toBe(true)
    expect(dismissed.length).toBeGreaterThan(0)
    expect(ofWeb.length).toBeGreaterThan(0)
    expect(ofWeb.every((s: any) => s.src_zone_id === web || s.dst_zone_id === web)).toBe(true)
    expect(first.suggestions.map((s: any) => s.id)).toEqual(all.slice(1, 3).map((s: any) => s.id))
    expect(first).toMatchObject({ limit: 2, offset: 1 })
  })

  it('serves 2 or 3 drifts of the kinds the Drifts tab explains', async () => {
    const { drifts } = await demoGet(`${BASE}/drifts`)

    expect(drifts.length).toBeGreaterThanOrEqual(2)
    expect(drifts.length).toBeLessThanOrEqual(3)
    for (const d of drifts) {
      expect(['unzoned_running', 'nic_firewall_off', 'foreign_accept', 'ipset_out_of_sync']).toContain(d.kind)
      expect(d.guest.vmid).toBeGreaterThan(0)
    }
  })

  it('serves two revisions with their snapshot, newest first, and honours the limit', async () => {
    const { revisions } = await demoGet(`${BASE}/revisions`)
    const policy = await demoGet(`${BASE}/policy`)
    const one = await demoGet(`${BASE}/revisions?limit=1`)

    expect(revisions).toHaveLength(2)
    expect(revisions[0].version).toBeGreaterThan(revisions[1].version)
    expect(revisions[0].id).toBe(policy.last_revision.id)
    expect(revisions[0].snapshot.zones).toHaveLength(policy.zones.length)
    expect(revisions[0].snapshot.flows).toHaveLength(policy.flows.length)
    expect(revisions[1].snapshot.zones.length).toBeLessThan(revisions[0].snapshot.zones.length)
    expect(one.revisions).toHaveLength(1)
  })

  it('serves the runs newest first without their result, and a run with its result', async () => {
    const { runs, limit, offset } = await demoGet(`${BASE}/runs`)

    expect(runs.length).toBeGreaterThanOrEqual(3)
    expect(limit).toBe(50)
    expect(offset).toBe(0)

    const times = runs.map((r: any) => Date.parse(r.started_at))

    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(runs.every((r: any) => !('result' in r))).toBe(true)
    expect(runs.map((r: any) => r.kind)).toEqual(expect.arrayContaining(['apply', 'full']))

    const apply = runs.find((r: any) => r.kind === 'apply' && r.status === 'done')
    const detail = await demoGet(`${BASE}/runs/${apply.id}`)

    expect(detail.id).toBe(apply.id)
    expect(detail.result.complete).toBe(true)
    expect((await demoGet(`${BASE}/runs?limit=2`)).runs).toHaveLength(2)
  })

  it('serves a pre-flight with exactly one warning and no failure', async () => {
    const { checks } = await demoGet(`${BASE}/preflight`)
    const by = (s: string) => checks.filter((c: any) => c.status === s)

    expect(by('warn')).toHaveLength(1)
    expect(by('fail')).toHaveLength(0)
    expect(by('pass').length).toBeGreaterThanOrEqual(2)
  })

  it.each([
    ['POST', `${BASE}/zones`],
    ['POST', `${BASE}/emergency-stop`],
    ['POST', `${BASE}/zones/demo-zone-app/egress-state`],
    ['PUT', `${BASE}/policy`],
    ['DELETE', `${BASE}/flows/demo-flow-web-app`],
  ])('refuses %s %s as the demo locks its other mutations, with the code the tab translates', async (method, path) => {
    const res = await demo(path, method)

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Action disabled in demo mode' })
  })
})

describe('demo micro-segmentation, outbound', () => {
  it('puts the app zone in outbound observe over the local network and the internet, the others off', async () => {
    const { zones } = await demoGet(`${BASE}/policy`)
    const app = zones.find((z: any) => z.name === 'app')

    expect(app).toMatchObject({ egress_state: 'observe', egress_mode: 'all' })
    expect(Date.parse(app.egress_observe_since)).toBeLessThanOrEqual(Date.now())
    for (const z of zones.filter((x: any) => x.name !== 'app')) {
      expect(z.egress_state ?? 'off', z.name).toBe('off')
      expect(z.egress_observe_since ?? null, z.name).toBeNull()
    }
  })

  it('serves 3 outbound suggestions, one of them the aggregate, and filters by direction', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const app = policy.zones.find((z: any) => z.name === 'app').id
    const out = (await demoGet(`${BASE}/suggestions?direction=out`)).suggestions
    const inbound = (await demoGet(`${BASE}/suggestions?direction=in`)).suggestions
    const all = (await demoGet(`${BASE}/suggestions`)).suggestions

    expect(out).toHaveLength(3)
    expect(out.every((s: any) => s.direction === 'out' && s.src_zone_id === app && s.src_key === app)).toBe(true)
    expect(out.filter((s: any) => s.dst_key === '0.0.0.0/0' || s.dst_key === '::/0')).toHaveLength(1)
    expect(out.every((s: any) => s.dst_zone_id === '' && s.dst_key !== '')).toBe(true)
    expect(inbound.every((s: any) => (s.direction ?? 'in') === 'in')).toBe(true)
    expect(inbound.length + out.length).toBe(all.length)
  })

  it('reports the log reading of 3 nodes in the status', async () => {
    const { engine, log_nodes } = await demoGet(`${BASE}/status`)

    expect(engine).toBeDefined()
    expect(log_nodes).toHaveLength(3)
    for (const n of log_nodes) {
      expect(Object.keys(n).sort((a, b) => a.localeCompare(b))).toEqual(['full_pages_24h', 'lag_seconds', 'lines_last', 'lines_per_min_15m', 'node'])
    }
  })
})

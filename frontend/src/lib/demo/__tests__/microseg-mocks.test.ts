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

  it('serves the IP filter of the zone members: every member once, the states the tab tells apart, and a policy that agrees with it', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const filter = await demoGet(`${BASE}/ipfilter`)
    const preflight = await demoGet(`${BASE}/preflight`)

    expect(policy.policy.ip_filter).toBe(true)
    expect(filter.enabled).toBe(true)
    expect(filter.computed).toBe(true)
    expect(new Set(filter.guests.map((g: any) => `${g.type}/${g.vmid}`)).size).toBe(filter.guests.length)
    expect(new Set(filter.guests.map((g: any) => g.mode))).toEqual(new Set(['on', 'excluded', 'manual', 'no_address']))
    expect(filter.guests.some((g: any) => g.held.length > 0 && g.held[0].by)).toBe(true)
    expect(filter.guests.some((g: any) => g.dhcp.length > 0 && g.unknown.length > 0)).toBe(true)

    // The guest the admin left out is the one the filter reports excluded; the allowed address is in the guest's list.
    const leftOut = policy.policy.guest_filters.find((f: any) => f.disabled)
    expect(filter.guests.find((g: any) => g.vmid === leftOut.vmid).mode).toBe('excluded')
    const extra = policy.policy.guest_filters.find((f: any) => f.extra)
    expect(filter.guests.find((g: any) => g.vmid === extra.vmid).nics.net0).toContain(extra.extra[0])

    const check = preflight.checks.find((c: any) => c.id === 'ip_filter')
    expect(check.detail.members).toBe(filter.guests.length)
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

  it('serves a pre-flight with two warnings (the log rate, the IP filter) and no failure', async () => {
    const { checks } = await demoGet(`${BASE}/preflight`)
    const by = (s: string) => checks.filter((c: any) => c.status === s)

    expect(by('warn').map((c: any) => c.id)).toEqual(['log_ratelimit', 'ip_filter'])
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
  it('puts the app zone in outbound observe over the local network and the internet, the db zone in outbound blocking, the others off', async () => {
    const { zones } = await demoGet(`${BASE}/policy`)
    const app = zones.find((z: any) => z.name === 'app')
    const db = zones.find((z: any) => z.name === 'db')

    expect(app).toMatchObject({ egress_state: 'observe', egress_mode: 'all' })
    expect(Date.parse(app.egress_observe_since)).toBeLessThanOrEqual(Date.now())
    // A zone that blocks its outbound: what the zones chip of the Dashboard counts ("outbound 1 / 5").
    expect(db).toMatchObject({ state: 'enforce', egress_state: 'enforce', egress_mode: 'local' })
    for (const z of zones.filter((x: any) => x.name !== 'app' && x.name !== 'db')) {
      expect(z.egress_state ?? 'off', z.name).toBe('off')
      expect(z.egress_observe_since ?? null, z.name).toBeNull()
    }
  })

  it('serves 4 outbound suggestions, one of them the aggregate and one blocked, and filters by direction', async () => {
    const policy = await demoGet(`${BASE}/policy`)
    const emitters = ['app', 'db'].map(name => policy.zones.find((z: any) => z.name === name).id)
    const out = (await demoGet(`${BASE}/suggestions?direction=out`)).suggestions
    const inbound = (await demoGet(`${BASE}/suggestions?direction=in`)).suggestions
    const all = (await demoGet(`${BASE}/suggestions`)).suggestions

    expect(out).toHaveLength(4)
    expect(out.every((s: any) => s.direction === 'out' && emitters.includes(s.src_zone_id) && s.src_key === s.src_zone_id)).toBe(true)
    // Only the zone whose outbound is blocked has a blocked outbound flow.
    expect(out.filter((s: any) => s.kind === 'blocked').map((s: any) => s.src_zone_id)).toEqual([emitters[1]])
    expect(out.filter((s: any) => s.dst_key === '0.0.0.0/0' || s.dst_key === '::/0')).toHaveLength(1)
    expect(out.every((s: any) => s.dst_zone_id === '' && s.dst_key !== '')).toBe(true)
    expect(inbound.every((s: any) => (s.direction ?? 'in') === 'in')).toBe(true)
    expect(inbound.length + out.length).toBe(all.length)
  })

  it('reports the log reading of 3 nodes in the status', async () => {
    const { engine } = await demoGet(`${BASE}/status`)
    const log_nodes = engine.log_nodes

    expect(engine).toBeDefined()
    expect(log_nodes).toHaveLength(3)
    for (const n of log_nodes) {
      expect(Object.keys(n).sort((a, b) => a.localeCompare(b))).toEqual(['full_pages_24h', 'lag_seconds', 'lines_last', 'lines_per_min_15m', 'node'])
    }
  })

  it('filters the suggestions on the ports of a service and on the sources in no zone, as the Dashboard opens the Observation list', async () => {
    const all = (await demoGet(`${BASE}/suggestions?status=pending&limit=200`)).suggestions
    const loki = (await demoGet(`${BASE}/suggestions?status=pending&service=tcp%2F3100`)).suggestions
    const two = (await demoGet(`${BASE}/suggestions?status=pending&service=tcp%2F3100&service=tcp%2F22`)).suggestions
    const unknown = (await demoGet(`${BASE}/suggestions?status=pending&source=unknown`)).suggestions

    expect(loki.length).toBeGreaterThan(0)
    expect(loki.every((s: any) => s.proto === 'tcp' && s.dport === '3100')).toBe(true)
    expect(two.length).toBeGreaterThan(loki.length)
    expect(two.every((s: any) => ['3100', '22'].includes(s.dport))).toBe(true)
    expect(unknown.length).toBeGreaterThan(0)
    expect(unknown.every((s: any) => s.src_zone_id === '')).toBe(true)
    expect(unknown.length).toBeLessThan(all.length)
  })

  it('serves the traffic history the time charts read: buckets on the step, zones by name, both directions, the same on a second read', async () => {
    const to = new Date(Math.floor(Date.now() / 300_000) * 300_000)
    const from = new Date(to.getTime() - 3_600_000)
    const path = `${BASE}/traffic?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&step=300`
    const first = await demoGet(path)
    const { zones } = await demoGet(`${BASE}/policy`)
    const names = new Set(zones.map((z: any) => z.name))

    expect(first).toMatchObject({ step: 300, from: from.toISOString(), to: to.toISOString() })
    expect(new Set(first.buckets.map((b: any) => b.at)).size).toBe(12)
    for (const b of first.buckets) {
      expect(Date.parse(b.at) % 300_000).toBe(0)
      expect(names.has(b.zone), b.zone).toBe(true)
      expect(b.src_zone === '' || names.has(b.src_zone), b.src_zone).toBe(true)
      expect(['would_block', 'blocked']).toContain(b.verdict)
      expect(b.hits).toBeGreaterThan(0)
    }
    expect(first.buckets.some((b: any) => b.direction === 'out')).toBe(true)
    // The blocked flows are rare (a few hits an hour): a day of history holds them.
    const day = await demoGet(`${BASE}/traffic?from=${encodeURIComponent(new Date(to.getTime() - 86_400_000).toISOString())}&to=${encodeURIComponent(to.toISOString())}&step=3600`)

    expect(day.buckets.some((b: any) => b.verdict === 'blocked' && b.direction === 'out' && b.zone === 'db')).toBe(true)
    expect(day.buckets.some((b: any) => b.verdict === 'blocked' && !b.direction)).toBe(true)
    // A chart that scrolls: the past buckets do not change between two reads.
    expect((await demoGet(path)).buckets).toEqual(first.buckets)
    // The direction the zone panel asks for.
    const out = await demoGet(`${path}&direction=out`)

    expect(out.buckets.length).toBeGreaterThan(0)
    expect(out.buckets.every((b: any) => b.direction === 'out')).toBe(true)
  })

  it('serves the sFlow volume: buckets on the step, the services summed per pair, or the totals of the window', async () => {
    const to = new Date()
    const from = new Date(to.getTime() - 3_600_000)
    const window = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`
    const steps = await demoGet(`${BASE}/volume?${window}&step=300`)
    expect(steps.covered).toBe(true)
    expect(steps.buckets.length).toBeGreaterThan(0)
    expect(steps.buckets.every((b: { at: string }) => Date.parse(b.at) % 300_000 === 0)).toBe(true)
    expect(steps.buckets.some((b: { src_zone: string; dst_zone: string; port: number }) => b.src_zone === 'app' && b.dst_zone === 'db' && b.port === 5432)).toBe(true)
    const pairs = await demoGet(`${BASE}/volume?${window}&step=300&group=pair`)
    expect(pairs.buckets.every((b: { proto: string; port: number }) => b.proto === '' && b.port === 0)).toBe(true)
    const totals = await demoGet(`${BASE}/volume?${window}&totals=1`)
    expect(new Set(totals.buckets.map((b: { at: string }) => b.at)).size).toBe(1)
    const sum = (list: { bytes: number }[]) => list.reduce((s, b) => s + b.bytes, 0)
    expect(sum(totals.buckets)).toBeGreaterThan(0)
  })

  it('bounds the traffic history to seven days of five-minute buckets, whatever is asked', async () => {
    const to = new Date()
    const from = new Date(to.getTime() - 400 * 86_400_000)
    const { buckets } = await demoGet(`${BASE}/traffic?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&step=300`)

    expect(new Set(buckets.map((b: any) => b.at)).size).toBeLessThanOrEqual(2_101)
  })

  it('serves the events of the engine newest first, filtered by zone, verdict and text, and pages them by sequence', async () => {
    const all = await demoGet(`${BASE}/events?limit=50`)

    expect(all.events).toHaveLength(50)
    expect(all.truncated).toBe(true)
    expect(all.oldest).toBe(all.events[49].ts)
    expect(all.events.every((e: any, i: number) => i === 0 || e.seq < all.events[i - 1].seq)).toBe(true)
    for (const e of all.events.slice(0, 10)) expect(e).toMatchObject({ node: expect.any(String), vmid: expect.any(Number), guest: expect.any(String), zone: expect.any(String), proto: expect.any(String) })

    const monitoring = (await demoGet(`${BASE}/events?zone=monitoring&limit=50`)).events
    const blocked = (await demoGet(`${BASE}/events?verdict=blocked&limit=50`)).events
    const port = (await demoGet(`${BASE}/events?q=3100&limit=50`)).events
    const older = (await demoGet(`${BASE}/events?limit=10&before_seq=${all.events[9].seq}`)).events

    expect(monitoring.length).toBeGreaterThan(0)
    expect(monitoring.every((e: any) => e.zone === 'monitoring' || e.src_zone === 'monitoring')).toBe(true)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.every((e: any) => e.verdict === 'blocked')).toBe(true)
    expect(port.every((e: any) => String(e.dport).includes('3100'))).toBe(true)
    expect(older[0].seq).toBe(all.events[10].seq)
  })

  it('serves the members of the security groups: the zone groups, with the guests of their zone', async () => {
    const usage = await demoGet('/api/v1/firewall/group-usage/demo-pve-cluster-001')
    const coverage = await demoGet('/api/v1/firewall/coverage/demo-pve-cluster-001')

    expect(usage).toMatchObject({ partial: false, unread: 0, computing: false, total: coverage.total })
    expect(usage.groups['pcz-web'].map((m: any) => m.vmid).sort()).toEqual(
      coverage.guests.filter((g: any) => g.tags.includes('zone-web')).map((g: any) => g.vmid).sort(),
    )
  })

  it('serves the guest coverage of the Dashboard: counts that add up, zone members filtered, the tags and VLANs the groupings read', async () => {
    const c = await demoGet('/api/v1/firewall/coverage/demo-pve-cluster-001')
    const vms = (await demoGet('/api/v1/vms?connId=demo-pve-cluster-001')).data.vms

    expect(c.guests.length).toBe(c.total)
    expect(c.enabled + c.disabled + c.unknown).toBe(c.total)
    expect(c.disabled).toBeGreaterThan(0)
    expect(c.computing).toBe(false)
    expect(Number.isNaN(Date.parse(c.computedAt))).toBe(false)
    const web = c.guests.filter((g: any) => g.tags.includes('zone-web'))

    expect(web.length).toBe(5)
    expect(web.every((g: any) => g.enabled === true && g.vlans.length === 1 && typeof g.vmid === 'string')).toBe(true)
    // The guest of the "NIC firewall off" drift: options on, NIC flag off, so not filtered.
    expect(c.guests.find((g: any) => g.vmid === '153')).toMatchObject({ optionsEnabled: true, nicFirewall: false, enabled: false })
    // Same guests as the inventory the map reads.
    expect(c.guests.every((g: any) => vms.some((v: any) => String(v.vmid) === g.vmid))).toBe(true)
  })
})

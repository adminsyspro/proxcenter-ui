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

const PROD = '/api/v1/connections/demo-pve-cluster-001'
const DR = '/api/v1/connections/demo-pve-dr-001'
const GUEST = `${PROD}/guests/qemu/pve-node-01/100`
const VM_KEY = encodeURIComponent('demo-pve-cluster-001:qemu:pve-node-01:100')

describe('inventory demo mocks: cluster panel', () => {
  it('cluster/config is the object ClusterTabs reads, per connection', async () => {
    const prod = await demoGet(`${PROD}/cluster/config`)
    const dr = await demoGet(`${DR}/cluster/config`)

    expect(prod.data.isCluster).toBe(true)
    expect(prod.data.clusterStatus.quorate).toBe(true)
    expect(prod.data.nodes).toHaveLength(12)
    expect(typeof prod.data.joinInfo.encoded).toBe('string')
    expect(Array.isArray(prod.data.networks)).toBe(true)
    expect(dr.data.nodes.map((n: any) => n.name)).toEqual(['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04'])
  })

  it('clusters lists both PVE connections', async () => {
    const body = await demoGet('/api/v1/clusters')

    expect(body.data.map((c: any) => c.id)).toEqual(['demo-pve-cluster-001', 'demo-pve-dr-001'])
  })

  it('diagnostics is the flat report DiagnosticModal reads', async () => {
    const body = await demoGet(`${PROD}/diagnostics`)

    expect(body.data).toBeUndefined()
    expect(Array.isArray(body.checks)).toBe(true)
    expect(body.summary.ok).toBeGreaterThan(0)
  })

  it('nextid skips used vmids and checks a requested one', async () => {
    const next = await demoGet(`${PROD}/cluster/nextid`)
    const taken = await demoGet(`${PROD}/cluster/nextid?vmid=100`)

    expect(next.available).toBe(true)
    expect(next.data).toBeGreaterThanOrEqual(100)
    expect(taken.available).toBe(false)
  })

  it('auto-ha, fingerprint and metric server detail are objects', async () => {
    expect((await demoGet(`${DR}/ha/auto-ha`)).data.enabled).toBe(false)
    expect((await demoGet(`${PROD}/fingerprint`)).data.fingerprint).toMatch(/^[0-9A-F:]+$/)
    expect((await demoGet(`${PROD}/cluster/metrics/server/influx-prod`)).data.type).toBe('influxdb')
  })
})

describe('inventory demo mocks: SDN and networks', () => {
  it('SDN panels get their wrapped lists', async () => {
    const status = await demoGet(`${PROD}/sdn/status`)

    expect(status.data.pveMajor).toBe(8)
    expect(Array.isArray(status.data.ipamBackends)).toBe(true)
    expect((await demoGet(`${PROD}/sdn/zones`)).data.zones.length).toBeGreaterThan(0)
    expect((await demoGet(`${DR}/sdn/zones`)).data.zones[0].zone).toBe('drvx')
    expect((await demoGet(`${PROD}/sdn/vnets`)).data.vnets.some((v: any) => v.vnet === 'a1b2c3d4')).toBe(true)
    expect(Array.isArray((await demoGet(`${PROD}/sdn/controllers`)).data.controllers)).toBe(true)
    expect(Array.isArray((await demoGet(`${PROD}/sdn/dns`)).data.dns)).toBe(true)
    expect((await demoGet(`${PROD}/sdn/ipams`)).data.ipams[0].ipam).toBe('pve')
    expect((await demoGet(`${PROD}/sdn/ipams/pve/status`)).data.allocations.length).toBeGreaterThan(0)
    expect((await demoGet(`${PROD}/sdn/vnets/a1b2c3d4/firewall/rules`)).data.rules.length).toBeGreaterThan(0)
    expect((await demoGet(`${PROD}/sdn/fabrics`)).data.unavailable).toBe(true)
  })

  it('networks carries guests, bridges and SDN vnets', async () => {
    const body = await demoGet(`${PROD}/networks`)

    expect(body.data[0].nets[0].bridge).toBe('vmbr0')
    expect(Array.isArray(body.bridges)).toBe(true)
    expect(Array.isArray(body.sdnVnets)).toBe(true)
    expect(typeof body.vnetAliases).toBe('object')
  })

  it('network-choices and node network/storages answer per node', async () => {
    const choices = await demoGet(`${PROD}/network-choices?node=pve-node-01`)
    const net = await demoGet(`${PROD}/nodes/pve-node-03/network`)
    const storages = await demoGet(`${PROD}/nodes/pve-node-03/storages?content=images`)

    expect(choices.data[0]).toMatchObject({ kind: 'bridge', name: 'vmbr0' })
    expect(net.data.find((i: any) => i.iface === 'vmbr0').address).toBe('10.10.10.3')
    expect(storages.data.length).toBeGreaterThan(0)
    expect(storages.data.every((s: any) => s.content.includes('images'))).toBe(true)
    expect((await demoGet(`${PROD}/nodes/pve-node-03/check-sshfs`)).data.installed).toBe(true)
  })
})

describe('inventory demo mocks: guest panel', () => {
  it('snapshots, notes, features and tasks of a guest key', async () => {
    const snaps = await demoGet(`/api/v1/guests/${VM_KEY}/snapshots`)
    const tasks = await demoGet(`/api/v1/guests/${VM_KEY}/tasks`)

    expect(Array.isArray(snaps.data.snapshots)).toBe(true)
    expect(snaps.data.count).toBe(snaps.data.snapshots.length)
    expect(typeof (await demoGet(`/api/v1/guests/${VM_KEY}/notes`)).data.content).toBe('string')
    expect((await demoGet(`/api/v1/guests/${VM_KEY}/features?feature=snapshot`)).data.hasFeature).toBe(true)
    expect(tasks.data.tasks[0].upid).toMatch(/^UPID:pve-node-01:/)
  })

  it('guest backups carry stats and the PBS flags', async () => {
    const body = await demoGet('/api/v1/guests/100/backups?type=vm&connectionId=demo-pve-cluster-001')

    expect(body.data.backups.length).toBeGreaterThan(0)
    expect(body.data.stats.total).toBe(body.data.backups.length)
    expect(body.data.pbsConfigured).toBe(true)
    expect(Array.isArray(body.data.warnings)).toBe(true)
  })

  it('agent, lock and migration pre-checks', async () => {
    expect((await demoGet(`${GUEST}/guest`)).data.osInfo.type).toBe('linux')
    expect((await demoGet(`${GUEST}/unlock`)).data.locked).toBe(false)
    expect((await demoGet(`${GUEST}/migrate/pending-check`)).data.changes).toEqual([])
    expect((await demoGet(`${GUEST}/migrate/snapshot-check?target=pve-node-02`)).data).toEqual({ live: [], offline: [] })
    expect(Array.isArray((await demoGet(`${GUEST}/remote-migrate/prepare`)).snapshots)).toBe(true)
    expect(Array.isArray((await demoGet(`${GUEST}/disk/snapshot-refs?disk=scsi0`)).data.snapshots)).toBe(true)
  })

  it('bulk snapshots of a node only list that node', async () => {
    const body = await demoGet(`${PROD}/snapshots?node=pve-node-01`)

    expect(body.data.snapshots.every((s: any) => s.node === 'pve-node-01')).toBe(true)
    expect(body.data.totalCount).toBe(body.data.snapshots.length)
  })
})

describe('inventory demo mocks: firewall and CVE', () => {
  it('firewall logs are a flat FirewallLogResult', async () => {
    const body = await demoGet('/api/v1/firewall/logs/demo-pve-cluster-001?scope=cluster&window=3600')

    expect(Array.isArray(body.rows)).toBe(true)
    expect(body.warnings).toEqual([])
    expect([...body.rows].sort((a: any, b: any) => b.ts - a.ts)).toEqual(body.rows)
  })

  it('microsegmentation analysis, VM list, status and simulation', async () => {
    const analysis = await demoGet('/api/v1/firewall/microseg/demo-pve-cluster-001/analyze?gateway_offset=1')
    const vms = await demoGet('/api/v1/firewall/microseg/demo-pve-cluster-001/vms')
    const status = await demoGet('/api/v1/firewall/microseg/demo-pve-cluster-001/vm/pve-node-01/qemu/100')
    const sim = await demoGet('/api/v1/firewall/microseg/demo-pve-cluster-001/vm/pve-node-01/qemu/100/simulate')

    expect(Array.isArray(analysis.networks)).toBe(true)
    expect(Array.isArray(analysis.missing_base_sgs)).toBe(true)
    expect(vms.total_vms).toBe(vms.vms.length)
    expect(status.networks[0].interface).toBe('net0')
    expect(Array.isArray(sim.blocked_flows)).toBe(true)
    expect(sim.simulated_state.is_isolated).toBe(true)
  })

  it('CVE scan answers GET and POST with nodes', async () => {
    const get = await demoGet('/api/v1/cve/demo-pve-cluster-001?node=pve-node-02')
    const post = await demoGet('/api/v1/cve/demo-pve-cluster-001', 'POST')

    expect(get.nodes.map((n: any) => n.node)).toEqual(['pve-node-02'])
    expect(get.vulnerabilities.every((v: any) => v.node === 'pve-node-02')).toBe(true)
    expect(post.nodes).toHaveLength(12)
  })
})

describe('inventory demo mocks: migrations, hosts, tasks', () => {
  it('migration list, detail and stats agree', async () => {
    const list = await demoGet('/api/v1/migrations')
    const stats = await demoGet('/api/v1/migrations/stats')
    const running = list.data.find((j: any) => j.status === 'transferring')
    const detail = await demoGet(`/api/v1/migrations/${running.id}`)

    expect(list.data.every((j: any) => j.sourceConnectionId === 'demo-esxi-001')).toBe(true)
    expect(detail.data.id).toBe(running.id)
    expect(stats.data.bySource['demo-esxi-001'].completed).toBe(list.data.filter((j: any) => j.status === 'completed').length)
    expect(stats.data.bySource['demo-esxi-001'].inProgress).toBe(1)
  })

  it('the list leaves logs out and narrows to a source VM; a job read slices its log past ?after=', async () => {
    // migrations/route.ts omits logs; migrations/[id]/route.ts returns sliceJobLogs (logOffset, logCount).
    const list = await demoGet('/api/v1/migrations')
    const job = list.data.find((j: any) => j.status === 'transferring')
    const one = await demoGet(`/api/v1/migrations?sourceVmId=${job.sourceVmId}&sourceConnectionId=demo-esxi-001`)
    const full = await demoGet(`/api/v1/migrations/${job.id}`)
    const tail = await demoGet(`/api/v1/migrations/${job.id}?after=2`)

    expect(list.data.every((j: any) => !('logs' in j))).toBe(true)
    expect(one.data.map((j: any) => j.id)).toEqual([job.id])
    expect(full.data.logOffset).toBe(0)
    expect(full.data.logs).toHaveLength(full.data.logCount)
    expect(tail.data.logOffset).toBe(2)
    expect(tail.data.logs).toEqual(full.data.logs.slice(2))
  })

  it('ESXi VM detail and copy interfaces', async () => {
    const vm = await demoGet('/api/v1/vmware/demo-esxi-001/vms/vm-101')
    const ifaces = await demoGet('/api/v1/vmware/demo-esxi-001/vms/vm-101/copy-interfaces')

    expect(vm.data.disks.length).toBeGreaterThan(0)
    expect(vm.data.disks[0].fileName).toMatch(/^\[datastore1\]/)
    expect(ifaces.data.vnics.some((v: any) => v.device === ifaces.data.defaultDevice)).toBe(true)
  })

  it('hosts are filtered by connection and tags are a list', async () => {
    const dr = await demoGet('/api/v1/hosts?connId=demo-pve-dr-001')

    expect(dr.data.hosts.map((h: any) => h.node)).toEqual(['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04'])
    expect(dr.data.stats.total).toBe(4)
    expect((await demoGet('/api/v1/tags')).data).toContain('gpu')
  })

  it('task detail of a running task from /tasks/running is running', async () => {
    const upid = 'UPID:pve-node-03:0001A2B3:0C4D5E6F:68C0D1E2:qmigrate:103:admin@pam:'
    const body = await demoGet(`/api/v1/tasks/demo-pve-cluster-001/pve-node-03/${encodeURIComponent(upid)}`)

    expect(body.status).toBe('running')
    expect(body.logs.length).toBeGreaterThan(0)
  })

  it('shared task detail carries its logs', async () => {
    const body = await demoGet('/api/v1/tasks/shared/demo-shared-001')

    expect(body.data.kind).toBe('migration')
    expect(Array.isArray(body.data.logs)).toBe(true)
  })
})

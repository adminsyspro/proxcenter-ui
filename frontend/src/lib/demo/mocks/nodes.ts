/**
 * Demo mocks for the node panels of the inventory (connections/[id]/nodes/[node]/...).
 * Everything is answered per node by the resolver, for both the production
 * cluster (pve-node-01..12) and the DR cluster (pve-dr-01..04). See ./index.ts.
 */

import { parseHwmon } from '@/lib/sensors/hwmon'

import MOCK_DATA from '../mock-data.json'

import type { DemoMockMap, DemoMockResolver } from './index'
import { resolveInventoryMock } from './inventory'

const MOCK: Record<string, any> = MOCK_DATA as any
const PROD = 'demo-pve-cluster-001'
const DR = 'demo-pve-dr-001'
const DAY = 86400

// Fixed reference instant (2026-10-01 00:00 UTC) so dates stay stable between polls.
const REF = 1790812800

const CONNECTIONS: any[] = MOCK['/api/v1/connections']?.data ?? []
const PROD_STATUS = MOCK[`/api/v1/connections/${PROD}/nodes/pve-node-01/status`]?.data ?? {}

const connKey = (connId: string) => (connId === DR ? DR : PROD)
const isDr = (connId: string) => connKey(connId) === DR

function hostsOf(connId: string): { node: string; ip: string }[] {
  return (CONNECTIONS.find(c => c.id === connKey(connId))?.hosts ?? []).map((h: any) => ({ node: h.node, ip: h.ip }))
}

type NodeCtx = { connId: string; node: string; dr: boolean; index: number; ip: string; seed: number }

function nodeCtx(connId: string, node: string): NodeCtx {
  const hosts = hostsOf(connId)
  const i = hosts.findIndex(h => h.node === node)
  const index = i >= 0 ? i : 0
  const dr = isDr(connId)

  return { connId: connKey(connId), node, dr, index, ip: hosts[index]?.ip ?? (dr ? '10.20.20.1' : '10.10.10.1'), seed: (dr ? 100 : 0) + index + 1 }
}

const hash = (n: number) => (((Math.imul(n | 0, 2654435761) >>> 0) % 10000) / 10000)
const domainOf = (ctx: NodeCtx) => (ctx.dr ? 'gra.demo.local' : 'par.demo.local')
const nodeVersion = () => String(PROD_STATUS.pveversion ?? 'pve-manager/8.4.1/2a5fa54a8503f96d').split('/')[1] ?? '8.4.1'

// --- Notes (useNodeData, tab Notes) ---

function notes(ctx: NodeCtx) {
  const role = ctx.dr
    ? 'Disaster recovery host (Gravelines). Receives storage replication from the production cluster.'
    : 'Production hypervisor (Paris). Member of the pve-prod-par cluster, Ceph OSD host.'

  return {
    notes: `# ${ctx.node}\n\n${role}\n\n- Management IP: ${ctx.ip}\n- Rack ${ctx.dr ? 'GRA-B' : 'PAR-A'}${String(Math.floor(ctx.index / 4) + 1).padStart(2, '0')}, unit ${10 + (ctx.index % 4) * 2}\n- Support contract: NBD, ref. ${ctx.dr ? 'DR' : 'PR'}-${4100 + ctx.seed}`,
    digest: `d3m0${ctx.seed.toString(16).padStart(4, '0')}`,
  }
}

// --- Subscription (formatSubscriptionData shape of the route) ---

// The two nodes the demo hardening report flags ("2 of 12 nodes have no active subscription").
const UNSUBSCRIBED_NODES = new Set(['pve-node-11', 'pve-node-12'])

function subscription(ctx: NodeCtx) {
  const key = `pve${ctx.dr ? 2 : 4}c-${(0x3a91c0d2 + ctx.seed * 7919).toString(16)}`
  const serverId = ((0x9f3e21c7 * ctx.seed) >>> 0).toString(16).toUpperCase().padStart(8, '0') + 'A41C7E92D05B3F68C14E7A90'

  if (!ctx.dr && UNSUBSCRIBED_NODES.has(ctx.node)) {
    return { status: 'notfound', type: 'Unknown', key: null, serverId, sockets: 2, lastChecked: null, nextDueDate: null, level: null, url: null, regdate: null }
  }

  return {
    status: 'active',
    type: `Proxmox VE Community Subscription ${ctx.dr ? 1 : 2} CPU/year`,
    key,
    serverId,
    sockets: ctx.dr ? 1 : 2,
    lastChecked: new Date((REF + 27 * DAY) * 1000).toISOString(),
    nextDueDate: ctx.dr ? '2027-05-02' : '2027-02-15',
    level: 'c',
    url: 'https://www.proxmox.com/en/proxmox-virtual-environment/pricing',
    regdate: ctx.dr ? '2026-05-02 09:12:44' : '2026-02-15 10:03:18',
  }
}

// --- Sensors (useNodeSensors), built from a fake hwmon dump so the parser decides roles ---

function sensors(ctx: NodeCtx) {
  const t = (base: number, k: number) => Math.round((base + hash(ctx.seed * 13 + k) * 9) * 1000)
  const lines = [
    '/sys/class/hwmon/hwmon0/name:acpitz',
    `/sys/class/hwmon/hwmon0/temp1_input:${t(27, 1)}`,
    '/sys/class/hwmon/hwmon1/name:k10temp',
    '/sys/class/hwmon/hwmon1/temp1_label:Tctl',
    `/sys/class/hwmon/hwmon1/temp1_input:${t(52, 2)}`,
    '/sys/class/hwmon/hwmon1/temp3_label:Tccd1',
    `/sys/class/hwmon/hwmon1/temp3_input:${t(48, 3)}`,
    '/sys/class/hwmon/hwmon2/name:nvme',
    '/sys/class/hwmon/hwmon2/temp1_label:Composite',
    `/sys/class/hwmon/hwmon2/temp1_input:${t(38, 4)}`,
    '/sys/class/hwmon/hwmon3/name:nvme',
    '/sys/class/hwmon/hwmon3/temp1_label:Composite',
    `/sys/class/hwmon/hwmon3/temp1_input:${t(40, 5)}`,
    '/sys/class/hwmon/hwmon4/name:spd5118',
    `/sys/class/hwmon/hwmon4/temp1_input:${t(41, 6)}`,
  ]
  const parsed = parseHwmon(lines.join('\n'))

  return { available: true, ...parsed }
}

// --- System report (NodeTabs "System Report" dialog reads a plain string) ---

function report(ctx: NodeCtx) {
  const host = `${ctx.node}.${domainOf(ctx)}`

  return [
    '==== general system info ====',
    '',
    '# hostname',
    ctx.node,
    '',
    '# pveversion --verbose',
    `proxmox-ve: 8.4.0 (running kernel: 6.8.12-9-pve)`,
    `pve-manager: ${nodeVersion()} (running version: ${nodeVersion()}/2a5fa54a8503f96d)`,
    'proxmox-kernel-6.8: 6.8.12-9',
    'ceph: 18.2.4-pve3',
    'corosync: 3.1.9-pve1',
    'qemu-server: 8.3.12',
    'pve-ha-manager: 4.0.7',
    'zfsutils-linux: 2.2.7-pve2',
    '',
    '# cat /etc/hosts',
    '127.0.0.1 localhost.localdomain localhost',
    `${ctx.ip} ${host} ${ctx.node}`,
    '',
    '# pvesubscription get',
    'message: ',
    `serverid: ${subscription(ctx).serverId}`,
    'status: active',
    '',
    '# lscpu',
    'Model name:          AMD EPYC 9354 32-Core Processor',
    `Socket(s):           ${ctx.dr ? 1 : 2}`,
    'Thread(s) per core:  2',
    '',
    '# pvesh get /cluster/resources --type node --output-format=yaml',
    ...hostsOf(ctx.connId).map(h => `- id: node/${h.node}\n  status: online`),
    '',
    '==== info about storage ====',
    '',
    '# pvesm status',
    'Name             Type     Status           Total            Used       Available        %',
    'local             dir     active        20448848         12376348         7008320   60.52%',
    ctx.dr ? 'local-zfs     zfspool     active      3771924480       912384000      2859540480   24.19%' : 'ceph-pool       rbd     active     53532936328     32517709840     21015226488   60.74%',
    '',
  ].join('\n')
}

// --- System tab (route section=all|network|certificates|dns|hosts|options|time) ---

function nodeNetworkRows(ctx: NodeCtx): any[] {
  const path = `/api/v1/connections/${ctx.connId}/nodes/${ctx.node}/network`
  const res = resolveInventoryMock('GET', path, new URL(`http://demo${path}`))

  return Array.isArray(res?.data) ? res.data : []
}

const NETWORK_ORDER: Record<string, number> = { bridge: 0, OVSBridge: 1, bond: 2, eth: 3, vlan: 4 }

function systemNetwork(ctx: NodeCtx) {
  return nodeNetworkRows(ctx)
    .map((i: any) => ({
      iface: i.iface, type: i.type, active: i.active, autostart: i.autostart, method: i.method, method6: i.method6,
      address: i.address, netmask: i.netmask, gateway: i.gateway, address6: i.address6, netmask6: i.netmask6, gateway6: i.gateway6,
      cidr: i.cidr, bridge_ports: i.bridge_ports, bridge_stp: i.bridge_stp, bridge_fd: i.bridge_fd, bridge_vlan_aware: i.bridge_vlan_aware,
      bond_mode: i.bond_mode, bond_primary: i.bond_primary, bond_xmit_hash_policy: i['bond-xmit-hash-policy'] ?? i.bond_xmit_hash_policy,
      slaves: i.slaves, vlan_id: i['vlan-id'], vlan_raw_device: i['vlan-raw-device'], mtu: i.mtu, comments: i.comments, families: i.families,
    }))
    .sort((a: any, b: any) => (NETWORK_ORDER[a.type] ?? 5) - (NETWORK_ORDER[b.type] ?? 5))
}

function systemCertificates(ctx: NodeCtx) {
  const host = `${ctx.node}.${domainOf(ctx)}`
  const fp = (k: number) => Array.from({ length: 32 }, (_, i) => Math.floor(hash(ctx.seed * 97 + k * 31 + i) * 256).toString(16).toUpperCase().padStart(2, '0')).join(':')
  // Three prod nodes still serve the self-signed certificate (hardening report).
  const selfSigned = !ctx.dr && ctx.index >= 9

  return [
    {
      filename: 'pve-root-ca.pem', fingerprint: fp(1), issuer: `/CN=Proxmox Virtual Environment/OU=${ctx.dr ? 'dr' : 'prod'}-cluster-ca/O=PVE Cluster Manager CA`,
      subject: `/CN=Proxmox Virtual Environment/OU=${ctx.dr ? 'dr' : 'prod'}-cluster-ca/O=PVE Cluster Manager CA`,
      notBefore: REF - 600 * DAY, notAfter: REF + 3050 * DAY, san: [], publicKeyBits: 4096, publicKeyType: 'rsaEncryption',
    },
    {
      filename: 'pve-ssl.pem', fingerprint: fp(2), issuer: '/CN=Proxmox Virtual Environment/OU=pve-cluster-ca/O=PVE Cluster Manager CA',
      subject: `/OU=PVE Cluster Node/O=Proxmox Virtual Environment/CN=${host}`,
      notBefore: REF - 600 * DAY, notAfter: REF + 130 * DAY, san: ['127.0.0.1', '0:0:0:0:0:0:0:1', 'localhost', ctx.ip, ctx.node, host], publicKeyBits: 2048, publicKeyType: 'rsaEncryption',
    },
    ...(selfSigned
      ? []
      : [{
          filename: 'pveproxy-ssl.pem', fingerprint: fp(3), issuer: "/C=US/O=Let's Encrypt/CN=R11", subject: `/CN=${host}`,
          notBefore: REF - 35 * DAY, notAfter: REF + 55 * DAY, san: [host], publicKeyBits: 2048, publicKeyType: 'rsaEncryption',
        }]),
  ]
}

function systemDns(ctx: NodeCtx) {
  return { search: domainOf(ctx), dns1: ctx.dr ? '10.20.0.53' : '10.10.0.53', dns2: ctx.dr ? '10.10.0.53' : '10.10.0.54', dns3: '1.1.1.1' }
}

function systemHosts(ctx: NodeCtx) {
  const lines = ['127.0.0.1 localhost.localdomain localhost', ...hostsOf(ctx.connId).map(h => `${h.ip} ${h.node}.${domainOf(ctx)} ${h.node}`), '', '# The following lines are desirable for IPv6 capable hosts', '::1     ip6-localhost ip6-loopback', 'ff02::1 ip6-allnodes', 'ff02::2 ip6-allrouters', '']

  return { data: lines.join('\n'), digest: `h0575${ctx.seed.toString(16).padStart(4, '0')}` }
}

function systemOptions(ctx: NodeCtx) {
  const host = `${ctx.node}.${domainOf(ctx)}`
  const selfSigned = !ctx.dr && ctx.index >= 9

  return {
    acme: selfSigned ? undefined : 'account=default',
    acmedomain0: selfSigned ? undefined : `domain=${host}`,
    acmedomain1: undefined,
    description: notes(ctx).notes,
    startall_onboot_delay: ctx.dr ? 0 : 30,
    wakeonlan: undefined,
  }
}

const TIMEZONES = ['UTC', 'Europe/Paris', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Singapore', 'Australia/Sydney']

function systemBody(ctx: NodeCtx, url: URL) {
  const section = url.searchParams.get('section') || 'all'
  const want = (s: string) => section === 'all' || section === s
  const now = Math.floor(Date.now() / 1000)
  const result: any = {}

  if (want('network')) result.network = systemNetwork(ctx)
  if (want('certificates')) result.certificates = systemCertificates(ctx)
  if (want('dns')) result.dns = systemDns(ctx)
  if (want('hosts')) result.hosts = systemHosts(ctx)
  if (want('options')) result.options = systemOptions(ctx)
  if (want('time')) {
    // Europe/Paris offset: +1h in winter, +2h in summer (close enough for a demo clock).
    const month = new Date(now * 1000).getUTCMonth()
    const offset = month >= 3 && month <= 9 ? 7200 : 3600

    result.time = { timezone: 'Europe/Paris', localtime: now + offset, time: now }
    if (section === 'time') result.timezones = TIMEZONES
  }

  return { data: result }
}

// --- Guests per node (prod from mock-data resources, DR = replicas as generated by demo-api) ---

const PROD_GUESTS: any[] = (MOCK[`/api/v1/connections/${PROD}/resources`]?.data ?? []).filter((r: any) => r.type === 'qemu' || r.type === 'lxc')
const DR_GUESTS: any[] = PROD_GUESTS.filter(g => g.vmid && !g.template).slice(0, 24).map((g, i) => ({
  vmid: 5000 + Number(g.vmid), name: `${g.name}-replica`, node: `pve-dr-0${(i % 4) + 1}`, type: 'qemu', status: 'stopped', template: false,
}))

const guestsOn = (ctx: NodeCtx) => (ctx.dr ? DR_GUESTS : PROD_GUESTS).filter(g => g.node === ctx.node)

// --- Ceph (node Ceph tab): prod 36 OSDs over 12 hosts, DR 12 OSDs with osd.10/osd.11 down ---

const CEPH_VERSION = '18.2.4'
const CEPH_FULL = `ceph version ${CEPH_VERSION} (2064df84afc61c7e63928121bfdd74c59453c893) reef (stable)`

function cephOsds(ctx: NodeCtx) {
  const count = ctx.dr ? 12 : 36
  const hosts = ctx.dr ? 4 : 12
  const prefix = ctx.dr ? 'pve-dr-' : 'pve-node-'
  const kbTotal = ctx.dr ? 8.95e8 : 1.07e9

  return Array.from({ length: count }, (_, id) => {
    const host = `${prefix}${String((id % hosts) + 1).padStart(2, '0')}`
    const down = ctx.dr && (id === 10 || id === 11)
    const pct = 55 + hash(id + (ctx.dr ? 500 : 0)) * 12
    const kb = Math.round(kbTotal)

    return {
      id, name: `osd.${id}`, host, status: down ? 'down' : 'up', up: !down, in: !down,
      device_class: ctx.dr ? 'hdd' : id < 24 ? 'ssd' : 'hdd', osdtype: 'bluestore',
      crush_weight: Math.round((kb / 1024 ** 3) * 1000) / 1000, reweight: down ? 0 : 1,
      kb, kb_used: down ? 0 : Math.round(kb * pct / 100), kb_avail: down ? kb : Math.round(kb * (1 - pct / 100)),
      percent_used: down ? 0 : Math.round(pct * 100) / 100, num_pgs: down ? 0 : Math.round(((ctx.dr ? 128 : 256) * 3) / count),
      ceph_version_short: CEPH_VERSION,
    }
  })
}

function cephHealth(ctx: NodeCtx) {
  if (!ctx.dr) return { status: 'HEALTH_OK', checks: {} }

  return {
    status: 'HEALTH_ERR',
    checks: {
      OSD_DOWN: { severity: 'HEALTH_ERR', summary: { message: '2 osds down', count: 2 }, detail: [{ message: 'osd.10 (root=default,host=pve-dr-03) is down' }, { message: 'osd.11 (root=default,host=pve-dr-04) is down' }] },
      PG_DEGRADED: { severity: 'HEALTH_WARN', summary: { message: 'Degraded data redundancy: 10 pgs undersized', count: 10 }, detail: [{ message: 'pg 1.3f is stuck undersized for 41m, acting [2,5]' }] },
      OSDMAP_FLAGS: { severity: 'HEALTH_WARN', summary: { message: 'noout,norebalance flag(s) set', count: 2 }, detail: [] },
    },
  }
}

function nodeCephBody(ctx: NodeCtx, url: URL) {
  const section = url.searchParams.get('section') || 'all'
  const want = (s: string) => section === 'all' || section === s
  const site = ctx.dr ? 20 : 10
  const monNodes = ctx.dr ? ['pve-dr-01', 'pve-dr-02', 'pve-dr-03'] : ['pve-node-01', 'pve-node-02', 'pve-node-03']
  const mgrNodes = monNodes
  const osds = cephOsds(ctx)
  const fsid = ctx.dr ? '0c4e7a1b-93d2-4f58-8a61-2b7d5e9f30c4' : 'e1a5c2d9-7b34-4e8f-a0c6-5d91f2b83e7a'
  const health = cephHealth(ctx)
  const result: any = { hasCeph: true }

  if (want('status')) {
    result.health = health
    result.version = CEPH_VERSION
    result.status = {
      fsid, health,
      monmap: { fsid, mons: monNodes.map((n, i) => ({ name: n, addr: `10.${site}.20.${i + 1}:6789/0` })) },
      osdmap: { num_osds: osds.length, num_up_osds: osds.filter(o => o.up).length, num_in_osds: osds.filter(o => o.in).length },
      pgmap: { num_pgs: ctx.dr ? 128 : 256 },
    }
  }
  if (want('config')) {
    const raw = [
      '[global]',
      '\tauth_client_required = cephx',
      '\tauth_cluster_required = cephx',
      '\tauth_service_required = cephx',
      `\tcluster_network = 172.16.${site}.0/24`,
      `\tfsid = ${fsid}`,
      `\tmon_allow_pool_delete = true`,
      `\tmon_host = ${monNodes.map((_, i) => `10.${site}.20.${i + 1}`).join(' ')}`,
      '\tms_bind_ipv4 = true',
      '\tosd_pool_default_min_size = 2',
      '\tosd_pool_default_size = 3',
      `\tpublic_network = 10.${site}.20.0/24`,
      '',
      '[client]',
      '\tkeyring = /etc/pve/priv/$cluster.$name.keyring',
      '',
      ...monNodes.flatMap((n, i) => [`[mon.${n}]`, `\tpublic_addr = 10.${site}.20.${i + 1}`, '']),
    ].join('\n')
    const hosts = [...new Set(osds.map(o => o.host))]

    result.config = {
      raw,
      global: { global: { fsid, mon_host: monNodes.map((_, i) => `10.${site}.20.${i + 1}`).join(' '), cluster_network: `172.16.${site}.0/24`, public_network: `10.${site}.20.0/24` }, client: { keyring: '/etc/pve/priv/$cluster.$name.keyring' } },
      database: [
        { section: 'global', name: 'osd_pool_default_pg_autoscale_mode', value: 'on', level: 'advanced', can_update_at_runtime: 1 },
        { section: 'mgr', name: 'mgr/dashboard/ssl', value: 'false', level: 'advanced', can_update_at_runtime: 1 },
        { section: 'osd', name: 'osd_max_backfills', value: '2', level: 'advanced', can_update_at_runtime: 1 },
        { section: 'osd', name: 'osd_recovery_max_active', value: '4', level: 'advanced', can_update_at_runtime: 1 },
      ],
      crushMap: [
        '# begin crush map',
        'tunable choose_local_tries 0',
        'tunable chooseleaf_vary_r 1',
        'tunable straw_calc_version 1',
        '',
        '# devices',
        ...osds.map(o => `device ${o.id} osd.${o.id} class ${o.device_class}`),
        '',
        '# buckets',
        ...hosts.flatMap((h, hi) => [`host ${h} {`, `\tid -${hi + 2}`, '\talg straw2', '\thash 0', ...osds.filter(o => o.host === h).map(o => `\titem osd.${o.id} weight ${o.crush_weight.toFixed(3)}`), '}']),
        'root default {',
        '\tid -1',
        '\talg straw2',
        ...hosts.map(h => `\titem ${h} weight ${(osds.filter(o => o.host === h).reduce((a, o) => a + o.crush_weight, 0)).toFixed(3)}`),
        '}',
        '',
        '# rules',
        'rule replicated_rule {',
        '\tid 0',
        '\ttype replicated',
        '\tstep take default',
        '\tstep chooseleaf firstn 0 type host',
        '\tstep emit',
        '}',
        '',
        '# end crush map',
      ].join('\n'),
    }
  }
  if (want('mon')) {
    result.monitors = monNodes.map((n, i) => ({
      name: n, host: n, addr: `10.${site}.20.${i + 1}:6789/0`, quorum: 1, rank: i, state: 'running', ceph_version: CEPH_FULL, ceph_version_short: CEPH_VERSION, direxists: 1,
    }))
    result.managers = { active: mgrNodes[0], activeAddr: `10.${site}.20.1:6801/1234`, standbys: mgrNodes.slice(1).map(n => ({ name: n })) }
  }
  if (want('osd')) {
    result.osds = osds
    result.osdStats = { num_osds: osds.length, num_up_osds: osds.filter(o => o.up).length, num_in_osds: osds.filter(o => o.in).length }
  }
  if (want('mds')) {
    result.mds = ctx.dr
      ? []
      : [
          { name: 'pve-node-01', host: 'pve-node-01', addr: '10.10.20.1:6801/1', state: 'up:active', rank: 0, ceph_version_short: CEPH_VERSION },
          { name: 'pve-node-02', host: 'pve-node-02', addr: '10.10.20.2:6801/1', state: 'up:standby', rank: null, ceph_version_short: CEPH_VERSION },
        ]
    result.cephfs = ctx.dr ? [] : [{ name: 'cephfs', metadata_pool: 'cephfs_metadata', data_pool: 'cephfs-data' }]
  }
  if (want('pools')) {
    const pool = (id: number, name: string, pg: number, pct: number, application: string) => ({
      pool: id, pool_name: name, size: 3, min_size: 2, pg_num: pg, pg_num_target: pg, pg_autoscale_mode: 'on', crush_rule: 0, crush_rule_name: 'replicated_rule',
      percent_used: pct / 100, type: 'replicated', application_metadata: { [application]: {} },
    })

    result.pools = ctx.dr
      ? [pool(1, '.mgr', 1, 0.01, 'mgr'), pool(2, 'rbd-dr', 128, 60, 'rbd')]
      : [pool(1, '.mgr', 1, 0.01, 'mgr'), pool(2, 'rbd-pool', 128, 55, 'rbd'), pool(3, 'cephfs-data', 64, 19, 'cephfs'), pool(4, 'cephfs_metadata', 16, 0.4, 'cephfs'), pool(5, 'rgw-pool', 64, 8, 'rgw')]
    result.crushRules = [{ name: 'replicated_rule' }]
  }
  if (want('log')) {
    const now = Math.floor(Date.now() / 60000) * 60
    const stamp = (t: number) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19)
    const pgs = ctx.dr ? 128 : 256
    const lines = Array.from({ length: 20 }, (_, i) => {
      const t = now - (19 - i) * 60

      return ctx.dr && i % 5 === 0
        ? `${stamp(t)} mon.pve-dr-01 (mon.0) ${3200 + i} : cluster [WRN] Health check update: Degraded data redundancy: 10 pgs undersized (PG_DEGRADED)`
        : `${stamp(t)} mgr.${mgrNodes[0]} (mgr.${4100 + (ctx.dr ? 7 : 0)}) ${81200 + i} : cluster [DBG] pgmap v${912000 + i}: ${pgs} pgs: ${ctx.dr ? '118 active+clean, 10 active+undersized+degraded' : `${pgs} active+clean`}; ${ctx.dr ? '6.0 TiB data, 18 TiB used' : '21.7 TiB data, 65 TiB used'}`
    })

    result.log = lines
    result.logSource = 'syslog'
  }

  return { data: result }
}

// --- Ceph noout (useCephNoout) ---

function nodeNoout(ctx: NodeCtx, url: URL) {
  const osds = cephOsds(ctx).filter(o => o.host === ctx.node).map(o => ({ id: o.id, status: o.up ? 'up' : 'down', in: o.in }))
  const health = cephHealth(ctx)
  const data: any = {
    hasCeph: true,
    crushHost: osds.length > 0 ? ctx.node : null,
    osds,
    noout: false,
    hostFlags: [],
    globalNoout: ctx.dr,
    health: { status: health.status, checks: Object.entries(health.checks).map(([code, c]: [string, any]) => ({ code, severity: c.severity, message: c.summary.message })) },
    otherHostsWithNoout: [],
  }

  if (url.searchParams.get('precheck') === '1' && osds.length > 0) {
    const ok = !ctx.dr
    const total = Math.round(((ctx.dr ? 128 : 256) * 3) / (ctx.dr ? 4 : 12))

    data.okToStop = { ok, osds: osds.map(o => o.id), numOkPgs: ok ? total : total - 10, numNotOkPgs: ok ? 0 : 10, message: null }
  }

  return { data }
}

// --- Local VMs (NodeUpdateDialog, InventoryDetails): guests with disks on non-shared storage ---

function localVms(ctx: NodeCtx) {
  // Everything sits on Ceph; nas-01 keeps a data disk on the node's local directory storage.
  const list = guestsOn(ctx)
    .filter(g => !g.template && g.name === 'nas-01')
    .map(g => ({ vmid: g.vmid, name: g.name, type: g.type, status: g.status, localDisks: ['scsi1: local'], hasReplication: false }))
  const blocking = list.filter(v => v.status === 'running' && !v.hasReplication)

  return {
    data: {
      localStorages: ['local'],
      localVms: list,
      summary: { total: list.length, running: list.filter(v => v.status === 'running').length, withReplication: 0, blockingMigration: blocking.length, canMigrate: blocking.length === 0 },
    },
  }
}

// --- Replication tab: Ceph-backed clusters run no ZFS replication job, the guest picker still lists the node's guests ---

function replication(ctx: NodeCtx) {
  return {
    data: {
      jobs: [],
      nodes: hostsOf(ctx.connId).filter(h => h.node !== ctx.node).map(h => ({ node: h.node, status: 'online', online: true })),
      guests: guestsOn(ctx).filter(g => !g.template).map(g => ({ vmid: g.vmid, name: g.name, type: g.type, status: g.status })),
    },
  }
}

// --- APT updates: nodes 09-12 are already patched, the DR cluster lags behind ---

const APT_PACKAGES: Array<[string, string, string, string, string]> = [
  ['pve-manager', '8.4.1', '8.4.5', 'Proxmox Virtual Environment Management Tools', 'admin'],
  ['qemu-server', '8.3.12', '8.3.14', 'Qemu Server Tools', 'admin'],
  ['pve-qemu-kvm', '9.2.0-5', '9.2.0-7', 'Full virtualization on x86 hardware', 'admin'],
  ['proxmox-kernel-6.8', '6.8.12-9', '6.8.12-13', 'Latest Proxmox Kernel Image', 'kernel'],
  ['libpve-storage-perl', '8.3.6', '8.3.7', 'Proxmox VE storage management library', 'perl'],
  ['ceph-common', '18.2.4-pve3', '18.2.7-pve1', 'common utilities to mount and interact with a ceph storage cluster', 'admin'],
  ['openssh-server', '1:9.2p1-2+deb12u5', '1:9.2p1-2+deb12u6', 'secure shell (SSH) server, for secure access from remote machines', 'net'],
  ['libssl3', '3.0.15-1~deb12u1', '3.0.16-1~deb12u1', 'Secure Sockets Layer toolkit - shared libraries', 'libs'],
  ['tzdata', '2025a-0+deb12u1', '2025b-0+deb12u1', 'time zone and daylight-saving time data', 'localization'],
]

function aptPackages(ctx: NodeCtx) {
  const count = ctx.dr ? APT_PACKAGES.length : ctx.index >= 8 ? 0 : 6

  return APT_PACKAGES.slice(0, count).map(([pkg, oldV, newV, title, section]) => ({
    Package: pkg, OldVersion: oldV, Version: newV, Title: title, Description: title, Section: section, Priority: 'optional',
    Origin: pkg.startsWith('pve') || pkg.startsWith('proxmox') || pkg.startsWith('qemu') || pkg.startsWith('libpve') || pkg.startsWith('ceph') ? 'Proxmox' : 'Debian',
  }))
}

// Route shape of GET .../apt (loadNodeAptUpdates, InventoryDetails header).
function apt(ctx: NodeCtx) {
  const data = aptPackages(ctx).map(p => ({
    package: p.Package, title: p.Title, description: p.Description, currentVersion: p.OldVersion, newVersion: p.Version,
    origin: p.Origin, priority: p.Priority, section: p.Section,
  }))

  return { data, count: data.length, nodeVersion: nodeVersion() }
}

// The enterprise repository is configured with an active subscription (NodeUpdateDialog pre-flight).
function aptRepositories() {
  return {
    data: {
      standard_repos: [
        { handle: 'enterprise', name: 'Enterprise', status: 1 },
        { handle: 'no-subscription', name: 'No-Subscription' },
        { handle: 'test', name: 'Test' },
        { handle: 'ceph-reef-enterprise', name: 'Ceph Reef Enterprise', status: 1 },
        { handle: 'ceph-reef-no-subscription', name: 'Ceph Reef No-Subscription' },
      ],
      errors: [],
    },
  }
}

// --- Appliance templates (TemplateDownloadDialog) ---

const APLINFO = [
  ['debian-12-standard_12.7-1_amd64.tar.zst', 'debian-12-standard', 'system', 'debian-12', 'Debian 12 Bookworm (standard)', '12.7-1'],
  ['ubuntu-24.04-standard_24.04-2_amd64.tar.zst', 'ubuntu-24.04-standard', 'system', 'ubuntu-24.04', 'Ubuntu 24.04 Noble (standard)', '24.04-2'],
  ['rockylinux-9-default_20240912_amd64.tar.xz', 'rockylinux-9-default', 'system', 'rockylinux-9', 'Rocky Linux 9 (default)', '20240912'],
  ['alpine-3.20-default_20240908_amd64.tar.xz', 'alpine-3.20-default', 'system', 'alpine-3.20', 'Alpine Linux 3.20 (default)', '20240908'],
  ['archlinux-base_20240911-1_amd64.tar.zst', 'archlinux-base', 'system', 'archlinux', 'ArchLinux base image', '20240911-1'],
  ['debian-12-turnkey-gitea_18.0-1_amd64.tar.gz', 'turnkey-gitea', 'turnkeylinux', 'debian-12', 'TurnKey Gitea', '18.0-1'],
  ['debian-12-turnkey-nextcloud_18.1-1_amd64.tar.gz', 'turnkey-nextcloud', 'turnkeylinux', 'debian-12', 'TurnKey Nextcloud', '18.1-1'],
  ['debian-12-turnkey-wordpress_18.2-1_amd64.tar.gz', 'turnkey-wordpress', 'turnkeylinux', 'debian-12', 'TurnKey WordPress', '18.2-1'],
].map(([template, pkg, section, os, headline, version]) => ({
  template, package: pkg, section, os, headline, version, type: 'lxc', architecture: 'amd64',
  description: `${headline}. Container template provided by ${section === 'turnkeylinux' ? 'TurnKey Linux' : 'Proxmox'}.`,
  source: `http://download.proxmox.com/images/system/${template}`, location: `http://download.proxmox.com/images/system/${template}`,
  infopage: section === 'turnkeylinux' ? 'https://www.turnkeylinux.org/' : 'https://pve.proxmox.com/wiki/Linux_Container',
  maintainer: section === 'turnkeylinux' ? 'Turnkey Linux <support@turnkeylinux.org>' : 'Proxmox Support Team <support@proxmox.com>',
}))

// --- QEMU capabilities (CreateVmDialog, VmDetailTabs) ---

const CPU_MODELS = [
  ...['486', 'athlon', 'Broadwell', 'Cascadelake-Server', 'Conroe', 'EPYC', 'EPYC-Genoa', 'EPYC-IBPB', 'EPYC-Milan', 'EPYC-Rome', 'Haswell', 'host', 'Icelake-Server', 'IvyBridge', 'kvm32', 'kvm64', 'max', 'Nehalem', 'Penryn', 'qemu32', 'qemu64', 'SandyBridge', 'SapphireRapids', 'Skylake-Client', 'Skylake-Server', 'Westmere', 'x86-64-v2', 'x86-64-v2-AES', 'x86-64-v3', 'x86-64-v4']
    .map(name => ({ name, vendor: /EPYC|athlon|Opteron/.test(name) ? 'AuthenticAMD' : /^(host|max|kvm|qemu|x86)/.test(name) ? 'default' : 'GenuineIntel', custom: 0 })),
  { name: 'custom-epyc-genoa-nested', vendor: 'AuthenticAMD', custom: 1 },
]

const MACHINES = (['i440fx', 'q35'] as const).flatMap(type => ['9.2', '9.1', '9.0', '8.2', '8.1'].map(v => ({
  id: type === 'i440fx' ? `pc-i440fx-${v}` : `pc-q35-${v}`, type, version: type === 'i440fx' ? `pc-i440fx-${v}` : `pc-q35-${v}`, changes: v === '9.2' ? 'Default machine version of QEMU 9.2' : null,
})))

// --- Host hardware (passthrough pickers) ---

function pciDevices(ctx: NodeCtx) {
  const gpu = !ctx.dr && ctx.index >= 10

  return [
    { id: '0000:00:00.0', class: '0x060000', vendor: '0x1022', vendor_name: 'Advanced Micro Devices, Inc. [AMD]', device: '0x14a4', device_name: 'Genoa/Bergamo Root Complex', iommugroup: 0 },
    { id: '0000:01:00.0', class: '0x010802', vendor: '0x144d', vendor_name: 'Samsung Electronics Co Ltd', device: '0xa80a', device_name: 'NVMe SSD Controller PM9A1/PM9A3/980PRO', iommugroup: 12, subsystem_vendor_name: 'Samsung Electronics Co Ltd' },
    { id: '0000:41:00.0', class: '0x020000', vendor: '0x8086', vendor_name: 'Intel Corporation', device: '0x1593', device_name: 'Ethernet Controller E810-C for SFP', iommugroup: 30 },
    { id: '0000:41:00.1', class: '0x020000', vendor: '0x8086', vendor_name: 'Intel Corporation', device: '0x1593', device_name: 'Ethernet Controller E810-C for SFP', iommugroup: 31 },
    { id: '0000:c1:00.0', class: '0x030000', vendor: '0x1a03', vendor_name: 'ASPEED Technology, Inc.', device: '0x2000', device_name: 'ASPEED Graphics Family', iommugroup: 44 },
    ...(gpu ? [{ id: '0000:81:00.0', class: '0x030200', vendor: '0x10de', vendor_name: 'NVIDIA Corporation', device: '0x26b9', device_name: 'AD102GL [L40S]', iommugroup: 52, mdev: 1 }] : []),
  ]
}

const USB_DEVICES = [
  { busnum: 1, devnum: 1, port: 0, level: 0, class: 9, speed: '480', vendid: '0x1d6b', prodid: '0x0002', manufacturer: 'Linux Foundation', product: '2.0 root hub' },
  { busnum: 1, devnum: 2, port: 1, level: 1, class: 0, speed: '12', vendid: '0x046b', prodid: '0xff10', manufacturer: 'American Megatrends Inc.', product: 'Virtual Keyboard and Mouse', usbpath: '1-1' },
  { busnum: 2, devnum: 3, port: 2, level: 1, class: 0, speed: '480', vendid: '0x0529', prodid: '0x0001', manufacturer: 'Aladdin Knowledge Systems', product: 'HASP copy protection dongle', usbpath: '2-2' },
]

// --- Disks tab (route section=all|disks|lvm|lvmthin|directory|zfs, ?disk= adds SMART) ---

function nodeDiskList(ctx: NodeCtx) {
  const osdIds = cephOsds(ctx).filter(o => o.host === ctx.node).map(o => o.id)
  const serial = (k: number) => `S${(0x5f2a9c + ctx.seed * 131 + k * 17).toString(36).toUpperCase()}`

  return [
    { devpath: '/dev/sda', serial: serial(1), size: 480103981056, model: 'SAMSUNG MZ7L3480HCHQ-00A07', vendor: 'ATA', wwn: `0x5002538f4${ctx.seed}a1b2c3`, health: 'PASSED', type: 'ssd', rpm: 0, wearout: 96 - ctx.index, gpt: 1, used: 'BIOS boot', osdid: -1, mounted: true },
    { devpath: '/dev/sdb', serial: serial(2), size: 480103981056, model: 'SAMSUNG MZ7L3480HCHQ-00A07', vendor: 'ATA', wwn: `0x5002538f4${ctx.seed}a1b2c4`, health: 'PASSED', type: 'ssd', rpm: 0, wearout: 95 - ctx.index, gpt: 1, used: 'BIOS boot', osdid: -1, mounted: true },
    ...osdIds.map((id, k) => {
      const down = ctx.dr && (id === 10 || id === 11)
      const ssd = !ctx.dr && id < 24

      return {
        devpath: ssd ? `/dev/nvme${k}n1` : `/dev/sd${String.fromCharCode(99 + k)}`, serial: serial(10 + k),
        size: ssd ? 1920383410176 : ctx.dr ? 960197124096 : 1000204886016,
        model: ssd ? 'SAMSUNG MZQL21T9HCJR-00A07' : ctx.dr ? 'ST1000NM0055-1V410C' : 'WDC WD1003FBYZ-010FB0',
        vendor: ssd ? '' : 'ATA', wwn: `eui.${(0x3a9f + ctx.seed * 7 + k).toString(16)}0002538b11000001`,
        health: down ? 'FAILED' : 'PASSED', type: ssd ? 'nvme' : 'hdd', rpm: ssd ? 0 : 7200, wearout: ssd ? 92 - (ctx.index % 5) : 'N/A',
        gpt: 0, used: 'LVM', osdid: id, mounted: false,
      }
    }),
  ]
}

function nodeDisks(ctx: NodeCtx, url: URL) {
  const section = url.searchParams.get('section') || 'all'
  const want = (s: string) => section === 'all' || section === s
  const result: any = {}
  const disks = nodeDiskList(ctx)

  if (want('disks')) result.disks = disks
  if (want('lvm')) {
    result.lvm = [
      { name: 'pve', size: 478998192128, free: 16777216000, lvcount: 3, pvcount: 1, children: [{ name: '/dev/sda3', size: 478998192128, free: 16777216000, leaf: 1 }] },
      ...disks.filter(d => d.osdid >= 0).map(d => ({ name: `ceph-${(0x1f3a9c00 + d.osdid * 4099).toString(16)}-osd`, size: d.size, free: 0, lvcount: 1, pvcount: 1, children: [{ name: d.devpath, size: d.size, free: 0, leaf: 1 }] })),
    ]
  }
  if (want('lvmthin')) result.lvmthin = [{ lv: 'data', vg: 'pve', lv_size: 348966092800, used: Math.round(348966092800 * (0.08 + hash(ctx.seed) * 0.1)), metadata_size: 3556769792, metadata_used: 61865984 }]
  if (want('directory')) result.directory = []
  if (want('zfs')) result.zfs = []

  const disk = url.searchParams.get('disk')

  if (disk) {
    const d = disks.find(x => x.devpath === disk)

    result.smart = !d
      ? null
      : d.type === 'nvme'
        ? { health: d.health, type: 'text', text: `SMART/Health Information (NVMe Log 0x02)\nCritical Warning:                   0x00\nTemperature:                        ${38 + ctx.index % 5} Celsius\nAvailable Spare:                    100%\nAvailable Spare Threshold:          10%\nPercentage Used:                    ${100 - Number(d.wearout)}%\nData Units Read:                    ${(41823311 + ctx.seed * 1000).toLocaleString('en-US')} [21.4 TB]\nData Units Written:                 ${(83211790 + ctx.seed * 1000).toLocaleString('en-US')} [42.6 TB]\nPower On Hours:                     ${14200 + ctx.seed * 13}\nUnsafe Shutdowns:                   3\nMedia and Data Integrity Errors:    0\n` }
        : {
            health: d.health, type: 'ata',
            attributes: [
              { id: '  5', name: 'Reallocated_Sector_Ct', value: d.health === 'FAILED' ? 5 : 100, worst: d.health === 'FAILED' ? 5 : 100, threshold: 10, fail: d.health === 'FAILED' ? 'FAILING_NOW' : '-', flags: 'PO--CK', raw: d.health === 'FAILED' ? '1984' : '0' },
              { id: '  9', name: 'Power_On_Hours', value: 79, worst: 79, threshold: 0, fail: '-', flags: '-O--CK', raw: String(18400 + ctx.seed * 17) },
              { id: ' 12', name: 'Power_Cycle_Count', value: 100, worst: 100, threshold: 0, fail: '-', flags: '-O--CK', raw: '21' },
              { id: '190', name: 'Airflow_Temperature_Cel', value: 66, worst: 58, threshold: 0, fail: '-', flags: '-O---K', raw: `${34 + ctx.index % 4}` },
              { id: '197', name: 'Current_Pending_Sector', value: 100, worst: 100, threshold: 0, fail: '-', flags: '-O--C-', raw: '0' },
              { id: '199', name: 'UDMA_CRC_Error_Count', value: 200, worst: 200, threshold: 0, fail: '-', flags: '-OSRCK', raw: '0' },
            ],
          }
  }

  return { data: result }
}

// --- Syslog (System > Syslog): PVE lines, oldest first, one every 20 s ---

const NODE_LOG: Array<(ctx: NodeCtx) => string> = [
  () => 'pvedaemon[2241]: <root@pam> successful auth for user \'root@pam\'',
  () => 'pveproxy[3112]: worker 3398 finished',
  () => 'pveproxy[3112]: starting 1 worker(s)',
  () => 'pvestatd[1984]: status update time (0.412 seconds)',
  ctx => `corosync[1712]:   [KNET  ] link: host: ${ctx.dr ? 2 : 3} link: 0 is up`,
  () => 'systemd[1]: Started session-4211.scope - Session 4211 of User root.',
  () => 'pmxcfs[1650]: [status] notice: received log',
  () => 'chronyd[1102]: Selected source 10.10.0.123 (ntp.demo.local)',
  ctx => `ceph-osd[${2600 + ctx.index}]: osd.${ctx.index} pg_epoch: ${41200 + ctx.seed} heartbeat_check: ok`,
  () => 'pve-ha-lrm[2011]: successfully acquired lock \'ha_agent_lock\'',
  () => 'CRON[51833]: (root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function nodeSyslog(ctx: NodeCtx, url: URL) {
  const limit = Math.max(1, Math.min(5000, Number.parseInt(url.searchParams.get('limit') || '100', 10) || 100))
  const service = (url.searchParams.get('service') || '').toLowerCase()
  const now = Math.floor(Date.now() / 1000)
  const end = now - (now % 20)
  let lines: string[] = []

  for (let i = limit - 1; i >= 0; i--) {
    const t = end - i * 20
    const d = new Date(t * 1000)
    const msg = NODE_LOG[Math.floor(hash(t + ctx.seed * 7) * NODE_LOG.length)](ctx)

    lines.push(`${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${d.toISOString().slice(11, 19)} ${ctx.node} ${msg}`)
  }
  if (service) lines = lines.filter(l => l.toLowerCase().includes(service))

  return { data: lines, total: lines.length }
}

// --- Storage content (StorageContentBrowser, ISO/template pickers), filtered by ?content= ---

function storageContent(ctx: NodeCtx, storage: string, url: URL) {
  const wanted = (url.searchParams.get('content') || '').split(',').map(s => s.trim()).filter(Boolean)
  const ctime = (k: number) => REF - Math.floor(hash(k + ctx.seed) * 300) * DAY
  let items: any[] = []

  if (storage === 'local') {
    items = [
      ...[['debian-12.7.0-amd64-netinst.iso', 661651456], ['ubuntu-24.04.1-live-server-amd64.iso', 2773874688], ['Rocky-9.4-x86_64-minimal.iso', 1903165440], ['virtio-win-0.1.262.iso', 726970368], ['SERVER_EVAL_x64FRE_en-us.iso', 5397889024]]
        .map(([name, size], k) => ({ volid: `local:iso/${name}`, content: 'iso', format: 'iso', size, ctime: ctime(k) })),
      ...[['debian-12-standard_12.7-1_amd64.tar.zst', 126613824], ['ubuntu-24.04-standard_24.04-2_amd64.tar.zst', 141402048], ['alpine-3.20-default_20240908_amd64.tar.xz', 3194368]]
        .map(([name, size], k) => ({ volid: `local:vztmpl/${name}`, content: 'vztmpl', format: String(name).endsWith('.zst') ? 'tzst' : 'txz', size, ctime: ctime(20 + k) })),
      { volid: 'local:snippets/cloud-init-base.yaml', content: 'snippets', format: 'snippet', size: 1842, ctime: ctime(40) },
    ]
  } else if (storage === 'CephStoragePool') {
    items = (ctx.dr ? DR_GUESTS : PROD_GUESTS).map((g: any) => ({
      volid: `CephStoragePool:${g.template ? 'base' : 'vm'}-${g.vmid}-disk-0`, content: 'images', format: 'raw', vmid: g.vmid,
      size: g.maxdisk || 34359738368, used: Math.round((g.maxdisk || 34359738368) * (0.2 + hash(g.vmid) * 0.6)), ctime: ctime(g.vmid),
    }))
  } else if (storage === 'PBS_MASTER') {
    const today = Math.floor(Date.now() / 1000 / DAY) * DAY

    items = PROD_GUESTS.filter(g => !g.template).slice(0, 24).flatMap(g => [0, 1, 2].map(d => {
      const t = today - d * DAY + 2 * 3600
      const iso = new Date(t * 1000).toISOString().replace('.000', '')

      return { volid: `PBS_MASTER:backup/vm/${g.vmid}/${iso}`, content: 'backup', format: 'pbs-vm', subtype: 'qemu', vmid: g.vmid, size: Math.round((g.maxdisk || 34359738368) * 0.35), ctime: t, notes: g.name, verification: { state: 'ok' } }
    }))
  }

  if (wanted.length > 0) items = items.filter(i => wanted.includes(i.content))

  return { data: items }
}

export const NODES_MOCKS: DemoMockMap = {}

const NODE_PATH = /^\/api\/v1\/connections\/([^/]+)\/nodes\/([^/]+)\/(.+)$/

export const resolveNodesMock: DemoMockResolver = (method, cleanPath, url) => {
  const m = cleanPath.match(NODE_PATH)

  if (!m || method !== 'GET') return null

  const ctx = nodeCtx(decodeURIComponent(m[1]), decodeURIComponent(m[2]))
  const rest = m[3]

  switch (rest) {
    case 'notes': return { data: notes(ctx) }
    case 'subscription': return { data: subscription(ctx) }
    case 'sensors': return { data: sensors(ctx) }
    case 'maintenance': return { data: { maintenance: null } }
    case 'report': return { data: report(ctx) }
    case 'system': return systemBody(ctx, url)
    case 'ceph': return nodeCephBody(ctx, url)
    case 'ceph/noout': return nodeNoout(ctx, url)
    case 'local-vms': return localVms(ctx)
    case 'replication': return replication(ctx)
    // NodeUpdateDialog polls this flat body; no upgrade ever ran in the demo.
    case 'upgrade': return { status: 'UNKNOWN', logs: '', reboot_required: false }
    case 'apt': return apt(ctx)
    case 'apt/repositories': return aptRepositories()
    case 'updates': return { data: { updates: aptPackages(ctx), count: aptPackages(ctx).length, version: nodeVersion(), release: nodeVersion().split('.').slice(0, 2).join('.') } }
    case 'aplinfo': return { data: APLINFO }
    case 'cpu-models': return { data: CPU_MODELS, policy: null }
    case 'machines': return { data: MACHINES }
    case 'hardware/pci': return { data: pciDevices(ctx) }
    case 'hardware/usb': return { data: USB_DEVICES }
    case 'disks': return nodeDisks(ctx, url)
    case 'syslog': return nodeSyslog(ctx, url)
  }

  const iface = rest.match(/^network\/([^/]+)$/)

  if (iface) {
    const name = decodeURIComponent(iface[1])
    const row = nodeNetworkRows(ctx).find(i => i.iface === name)

    return row ? { data: row } : null
  }

  const content = rest.match(/^storage\/([^/]+)\/content$/)

  if (content) return storageContent(ctx, decodeURIComponent(content[1]), url)

  // No job exists (see replication above): an unknown job has an empty log.
  if (/^replication\/[^/]+$/.test(rest)) return { data: [] }

  return null
}

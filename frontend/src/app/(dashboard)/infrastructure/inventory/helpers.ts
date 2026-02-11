import type { InventorySelection, DetailsPayload, SeriesPoint, RrdTimeframe } from './types'

/* ------------------------------------------------------------------ */
/* Tag colors (stable "random")                                       */
/* ------------------------------------------------------------------ */

export const TAG_PALETTE = [
  '#e57000',
  '#2e7d32',
  '#1565c0',
  '#6a1b9a',
  '#00838f',
  '#c62828',
  '#ad1457',
  '#4e342e',
  '#455a64',
  '#7a7a00',
]

export function hashStringToInt(str: string) {
  let h = 0

  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0

return Math.abs(h)
}

export function tagColor(tag: string) {
  const idx = hashStringToInt(tag.toLowerCase()) % TAG_PALETTE.length


return TAG_PALETTE[idx]
}

/* ------------------------------------------------------------------ */
/* Helpers JSON / Array                                               */
/* ------------------------------------------------------------------ */

export function safeJson<T>(input: any): T {
  let cur = input

  while (cur && typeof cur === 'object' && 'data' in cur) cur = (cur as any).data

return cur as T
}

export function asArray<T>(input: any): T[] {
  if (Array.isArray(input)) return input

  if (input && typeof input === 'object') {
    if (Array.isArray((input as any).items)) return (input as any).items
    if (Array.isArray((input as any).guests)) return (input as any).guests
  }


return []
}

export function parseTags(tags?: string): string[] {
  if (!tags) return []

return String(tags)
    .split(/[;,]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */

export function pct(used: number, max: number) {
  if (!max || max <= 0) return 0

return Math.round((used / max) * 100)
}

export function cpuPct(v: any) {
  const n = Number(v ?? 0)

  if (!Number.isFinite(n)) return 0

return Math.round(n * 100)
}

export function formatBps(bps: number) {
  if (!Number.isFinite(bps) || bps <= 0) return '0 B/s'
  const u = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let v = bps

  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }


return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

export function formatTime(tsMs: number) {
  const d = new Date(tsMs)


return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (days > 0) {
    return `${days} days ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }


return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function parseMarkdown(md: string): string {
  if (!md) return ''

  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width: 100%;" />')
    .replace(/^---$/gm, '<hr />')
    .replace(/^\*\*\*$/gm, '<hr />')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[\*\-] (.*)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />')

  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>')

  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>'
  }

  return html
}

/* ------------------------------------------------------------------ */
/* Parsing IDs                                                        */
/* ------------------------------------------------------------------ */

export function parseNodeId(id: string) {
  const [connId, ...rest] = id.split(':')


return { connId, node: rest.join(':') }
}

export function parseVmId(id: string) {
  const [connId, node, type, vmid] = id.split(':')


return { connId, node, type, vmid }
}

/* ------------------------------------------------------------------ */
/* Metric icon                                                        */
/* ------------------------------------------------------------------ */

export function getMetricIcon(label: string): string {
  const l = label.toLowerCase()

  if (l.includes('cpu')) return 'ri-cpu-line'
  if (l.includes('ram') || l.includes('memory')) return 'ri-database-2-line'
  if (l.includes('storage') || l.includes('hd') || l.includes('disk')) return 'ri-hard-drive-2-line'
  if (l.includes('swap')) return 'ri-swap-line'
  if (l.includes('load')) return 'ri-dashboard-3-line'
  if (l.includes('io')) return 'ri-time-line'

return 'ri-bar-chart-line'
}

/* ------------------------------------------------------------------ */
/* RRD time-series helpers                                            */
/* ------------------------------------------------------------------ */

export function pickNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k]
    const n = Number(v)

    if (Number.isFinite(n)) return n
  }


return null
}

export function buildSeriesFromRrd(raw: any[], maxMem?: number): SeriesPoint[] {
  const out: SeriesPoint[] = []

  for (const p of raw) {
    const tSec = pickNumber(p, ['time', 't', 'timestamp'])

    if (!tSec) continue
    const t = Math.round(tSec) * 1000

    const cpuRaw = pickNumber(p, ['cpu', 'cpu_avg', 'cpuutil', 'cpuused'])

    const cpuPctVal =
      cpuRaw == null ? undefined : Math.max(0, Math.min(100, Math.round(cpuRaw <= 1.5 ? cpuRaw * 100 : cpuRaw)))

    const memRaw = pickNumber(p, ['mem', 'mem_avg', 'memory', 'memused', 'memtotal'])
    const maxMemRaw = pickNumber(p, ['maxmem', 'max_mem', 'memtotal', 'total']) || maxMem

    let ramPctVal: number | undefined = undefined

    if (memRaw != null) {
      if (memRaw <= 1.5) {
        ramPctVal = Math.max(0, Math.min(100, Math.round(memRaw * 100)))
      } else if (maxMemRaw && maxMemRaw > 0) {
        ramPctVal = Math.max(0, Math.min(100, Math.round((memRaw / maxMemRaw) * 100)))
      }
    }

    const netIn = pickNumber(p, ['netin', 'net_in', 'nics_netin', 'network_in'])
    const netOut = pickNumber(p, ['netout', 'net_out', 'nics_netout', 'network_out'])

    const loadAvg = pickNumber(p, ['loadavg', 'load_avg', 'load'])

    const diskRead = pickNumber(p, ['diskread', 'disk_read'])
    const diskWrite = pickNumber(p, ['diskwrite', 'disk_write'])

    out.push({
      t,
      cpuPct: cpuPctVal,
      ramPct: ramPctVal,
      loadAvg: loadAvg ?? undefined,
      netInBps: netIn ?? undefined,
      netOutBps: netOut ?? undefined,
      diskReadBps: diskRead ?? undefined,
      diskWriteBps: diskWrite ?? undefined,
    })
  }

  out.sort((a, b) => a.t - b.t)

return out
}

export async function fetchRrd(connectionId: string, path: string, timeframe: RrdTimeframe) {
  const res = await fetch(
    `/api/v1/connections/${encodeURIComponent(connectionId)}/rrd?path=${encodeURIComponent(path)}&timeframe=${encodeURIComponent(timeframe)}`,
    { cache: 'no-store' }
  )

  const json = await res.json()

  if (!res.ok) throw new Error(json?.error || `RRD HTTP ${res.status}`)

return asArray<any>(safeJson<any>(json))
}

export async function fetchDetails(sel: InventorySelection): Promise<DetailsPayload> {
  const lastUpdated = new Date().toLocaleString()

  if (sel.type === 'cluster') {
    const [connR, nodesR, resourcesR, cephR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/resources`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/ceph/status`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = sel.id
    let cephHealth: string | undefined

    try {
      const connData = await connR.json()

      connName = connData?.name || connData?.data?.name || sel.id
    } catch {}

    if (cephR?.ok) {
      try {
        const cephData = await cephR.json()
        const healthData = cephData.data?.health || cephData.health
        if (typeof healthData === 'string') {
          cephHealth = healthData
        } else if (healthData?.status) {
          cephHealth = healthData.status
        }
      } catch {}
    }

    const nodes = asArray<any>(safeJson(await nodesR.json()))
    const guests = asArray<any>(safeJson(await resourcesR.json()))

    const onlineNodes = nodes.filter((n: any) => n.status === 'online').length
    const runningVMs = guests.filter((g: any) => g.status === 'running').length
    const totalVMs = guests.length

    let totalCpu = 0
    let totalMem = 0
    let totalMaxMem = 0
    let totalDisk = 0
    let totalMaxDisk = 0

    for (const n of nodes) {
      totalCpu += Number(n.cpu ?? 0)
      totalMem += Number(n.mem ?? 0)
      totalMaxMem += Number(n.maxmem ?? 0)
      totalDisk += Number(n.disk ?? 0)
      totalMaxDisk += Number(n.maxdisk ?? 0)
    }

    const avgCpuPct = nodes.length > 0 ? cpuPct(totalCpu / nodes.length) : 0
    const memPctVal = totalMaxMem > 0 ? pct(totalMem, totalMaxMem) : 0
    const diskPctVal = totalMaxDisk > 0 ? pct(totalDisk, totalMaxDisk) : 0

    const nodesData = nodes.map((n: any) => {
      const vmCount = guests.filter((g: any) => g.node === n.node).length


return {
        id: `${sel.id}:${n.node}`,
        connId: sel.id,
        node: n.node,
        name: n.node,
        status: n.maintenance === 'maintenance' ? 'maintenance' as const : n.status === 'online' ? 'online' as const : 'offline' as const,
        cpu: cpuPct(n.cpu),
        ram: pct(Number(n.mem ?? 0), Number(n.maxmem ?? 0)),
        storage: pct(Number(n.disk ?? 0), Number(n.maxdisk ?? 0)),
        vms: vmCount,
        uptime: Number(n.uptime ?? 0),
        ip: n.ip || undefined,
      }
    })

    const allVms = guests.map((g: any) => ({
      id: `${sel.id}:${g.node}:${g.type}:${g.vmid}`,
      connId: sel.id,
      node: g.node,
      vmid: g.vmid,
      name: g.name || `VM ${g.vmid}`,
      status: g.status,
      type: g.type,
      template: g.template === 1,
      cpu: cpuPct(g.cpu),
      cpuPct: cpuPct(g.cpu),
      ram: pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0)),
      memPct: pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0)),
      maxmem: Number(g.maxmem ?? 0),
      disk: Number(g.disk ?? 0),
      maxdisk: Number(g.maxdisk ?? 0),
      uptime: Number(g.uptime ?? 0),
      tags: g.tags ? String(g.tags).split(';').filter(Boolean) : [],
    }))

    return {
      kindLabel: 'CLUSTER',
      title: connName,
      subtitle: undefined,
      breadcrumb: ['Infrastructure', 'Inventaire', 'Cluster', connName],
      status: onlineNodes === nodes.length ? 'ok' : onlineNodes > 0 ? 'warn' : 'crit',
      tags: [],
      kpis: [
        { label: 'Nodes', value: `${onlineNodes}/${nodes.length}` },
        { label: 'VMs', value: `${runningVMs}/${totalVMs}` },
      ],
      metrics: {
        cpu: { label: 'CPU (avg)', pct: avgCpuPct, used: avgCpuPct, max: 100 },
        ram: { label: 'RAM (total)', pct: memPctVal, used: totalMem, max: totalMaxMem },
        storage: { label: 'Storage (total)', pct: diskPctVal, used: totalDisk, max: totalMaxDisk },
      },
      properties: [],
      lastUpdated,
      nodesData,
      allVms,
      vmsCount: totalVMs,
      cephHealth,
    }
  }

  if (sel.type === 'node') {
    const { connId, node } = parseNodeId(sel.id)

    const [nodesR, statusR, resourcesR, versionR, subscriptionR, updatesR, maintenanceR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/version`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/apt`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`, { cache: 'no-store' }).catch(() => null),
    ])

    const nodes = asArray<any>(safeJson(await nodesR.json()))
    const n = nodes.find((x: any) => String(x.node) === String(node))

    if (!n) throw new Error('Node not found')

    let vmsData: DetailsPayload['vmsData'] = []

    if (resourcesR && resourcesR.ok) {
      try {
        const resources = asArray<any>(safeJson(await resourcesR.json()))

        const nodeVms = resources.filter((r: any) =>
          r.node === node && (r.type === 'qemu' || r.type === 'lxc')
        )

        vmsData = nodeVms.map((vm: any) => ({
          id: `${connId}:${vm.node}:${vm.type}:${vm.vmid}`,
          connId,
          node: vm.node,
          vmid: vm.vmid,
          name: vm.name || `VM ${vm.vmid}`,
          type: vm.type as 'qemu' | 'lxc',
          status: vm.status || 'unknown',
          cpu: vm.status === 'running' ? cpuPct(vm.cpu) : undefined,
          ram: vm.status === 'running' ? pct(Number(vm.mem ?? 0), Number(vm.maxmem ?? 0)) : undefined,
          maxmem: Number(vm.maxmem ?? 0),
          maxdisk: Number(vm.maxdisk ?? 0),
          uptime: Number(vm.uptime ?? 0),
          tags: parseTags(vm.tags),
          template: vm.template === 1,
        }))
      } catch {}
    }

    let statusData: any = null

    if (statusR && statusR.ok) {
      try {
        statusData = safeJson<any>(await statusR.json())
      } catch {}
    }

    let versionData: any = null

    if (versionR && versionR.ok) {
      try {
        versionData = safeJson<any>(await versionR.json())
      } catch {}
    }

    let subscriptionData: any = null

    if (subscriptionR && subscriptionR.ok) {
      try {
        const subResponse = await subscriptionR.json()
        subscriptionData = subResponse?.data || null
      } catch {}
    }

    let updatesData: any[] = []

    if (updatesR && updatesR.ok) {
      try {
        const updResponse = await updatesR.json()
        updatesData = updResponse?.data || []
      } catch {}
    }

    let maintenanceValue: string | undefined

    if (maintenanceR && maintenanceR.ok) {
      try {
        const maintData = await maintenanceR.json()
        maintenanceValue = maintData?.data?.maintenance || undefined
      } catch {}
    }

    const c = cpuPct(n.cpu)
    const r = pct(Number(n.mem ?? 0), Number(n.maxmem ?? 0))
    const d = pct(Number(n.disk ?? 0), Number(n.maxdisk ?? 0))

    const swapUsed = Number(statusData?.swap?.used ?? 0)
    const swapTotal = Number(statusData?.swap?.total ?? 0)
    const swapPctVal = swapTotal > 0 ? pct(swapUsed, swapTotal) : 0

    const uptimeSec = Number(n.uptime ?? statusData?.uptime ?? 0)

    const cpuInfoData = statusData?.cpuinfo || {}
    const cpuModel = cpuInfoData.model || cpuInfoData.cpus ? `${cpuInfoData.cpus || '?'} x ${cpuInfoData.model || 'Unknown'}` : null
    const cpuCoresVal = cpuInfoData.cores
    const cpuSocketsVal = cpuInfoData.sockets

    const kernelVersion = statusData?.kversion || statusData?.['kernel-version'] || null

    let pveVersionRaw = statusData?.pveversion || versionData?.version || null

    let pveVersion = pveVersionRaw

    if (pveVersionRaw && pveVersionRaw.includes('/')) {
      const parts = pveVersionRaw.split('/')

      pveVersion = parts[1] || pveVersionRaw
    }

    const bootMode = statusData?.['boot-info']?.mode?.toUpperCase() || null

    let loadAvg: string | null = null

    if (statusData?.loadavg) {
      if (Array.isArray(statusData.loadavg)) {
        loadAvg = statusData.loadavg
          .map((v: any) => {
            const num = Number(v)


return Number.isFinite(num) ? num.toFixed(2) : String(v)
          })
          .join(', ')
      } else {
        loadAvg = String(statusData.loadavg)
      }
    }

    const ioDelayRaw = statusData?.wait
    const ioDelay = ioDelayRaw != null && Number.isFinite(Number(ioDelayRaw)) ? Number(ioDelayRaw) * 100 : null

    const ksmSharing = statusData?.ksm?.shared ?? null

    const isPartOfCluster = nodes.length > 1
    let clusterName: string | null = null

    if (isPartOfCluster) {
      try {
        const clusterStatusR = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster`, { cache: 'no-store' })
        if (clusterStatusR.ok) {
          const clusterData = await clusterStatusR.json()
          clusterName = clusterData?.data?.name || 'Cluster'
        }
      } catch {
        clusterName = 'Cluster'
      }
    }

    return {
      kindLabel: 'HOST',
      title: node,
      subtitle: undefined,
      breadcrumb: ['Infrastructure', 'Inventaire', 'Host', node],
      status: n.status === 'online' ? 'ok' : 'crit',
      tags: [],
      kpis: [],
      metrics: {
        cpu: { label: 'CPU', pct: c, used: c, max: 100 },
        ram: { label: 'RAM', pct: r, used: Number(n.mem ?? 0), max: Number(n.maxmem ?? 0) },
        storage: { label: 'Storage', pct: d, used: Number(n.disk ?? 0), max: Number(n.maxdisk ?? 0) },
        swap: swapTotal > 0 ? { label: 'SWAP', pct: swapPctVal, used: swapUsed, max: swapTotal } : undefined,
      },
      properties: [],
      lastUpdated,
      hostInfo: {
        uptime: uptimeSec,
        cpuModel: cpuModel,
        cpuCores: cpuCoresVal,
        cpuSockets: cpuSocketsVal,
        kernelVersion,
        pveVersion,
        bootMode,
        loadAvg,
        ioDelay,
        ksmSharing,
        updates: updatesData || [],
        subscription: subscriptionData,
        maintenance: maintenanceValue,
      },
      vmsData,
      clusterName,
    }
  }

  if (sel.type === 'vm') {
    const { connId, node, type, vmid } = parseVmId(sel.id)

    const [resourcesR, nodesR, configR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`, { cache: 'no-store' }).catch(() => null),
    ])

    const resources = asArray<any>(safeJson(await resourcesR.json()))
    const nodes = asArray<any>(safeJson(await nodesR.json()))

    const isCluster = nodes.length > 1

    const hostNode = nodes.find((n: any) => n.node === node)
    const nodeCapacity = {
      maxCpu: hostNode?.maxcpu || 128,
      maxMem: hostNode?.maxmem || 128 * 1024 * 1024 * 1024,
    }

    const g = resources.find(
      (x: any) => String(x.node) === String(node) && String(x.type) === String(type) && String(x.vmid) === String(vmid)
    )

    if (!g) throw new Error('VM not found')

    const c = cpuPct(g.cpu)
    const r = pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0))
    const d = pct(Number(g.disk ?? 0), Number(g.maxdisk ?? 0))

    const vmTags = parseTags(g.tags)

    let cpuInfoVal: any = {}
    let memoryInfo: any = {}
    let disksInfo: any[] = []
    let networkInfo: any[] = []
    let optionsInfo: any = {}
    let name = g.name || `VM ${vmid}`
    let description = ''

    if (configR && configR.ok) {
      try {
        const configData = await configR.json()
        const config = configData?.data || configData

        name = config.name || name
        description = config.description || ''

        const pending = config.pending || {}

        cpuInfoVal = {
          sockets: config.sockets || 1,
          cores: config.cores || 1,
          type: config.cpu || 'kvm64',
          cpulimit: config.cpulimit,
          cpuunits: config.cpuunits,
          numa: config.numa === 1 || config.numa === true,
          pending: (pending.sockets !== undefined || pending.cores !== undefined || pending.cpu !== undefined || pending.cpulimit !== undefined) ? {
            sockets: pending.sockets,
            cores: pending.cores,
            cpu: pending.cpu,
            cpulimit: pending.cpulimit,
          } : undefined,
        }

        memoryInfo = {
          memory: config.memory || 512,
          balloon: config.balloon !== undefined ? config.balloon : config.memory,
          shares: config.shares,
          pending: (pending.memory !== undefined || pending.balloon !== undefined) ? {
            memory: pending.memory,
            balloon: pending.balloon,
          } : undefined,
        }

        Object.keys(config).forEach(key => {
          if (key.match(/^(scsi|ide|sata|virtio)\d+$/)) {
            const diskStr = config[key]

            const parts = String(diskStr).split(',')
            const storagePart = parts[0].split(':')
            const sizeMatch = diskStr.match(/size=(\d+[GMT]?)/i)

            disksInfo.push({
              id: key,
              storage: storagePart[0] || 'unknown',
              size: sizeMatch ? sizeMatch[1] : 'unknown',
              format: diskStr.includes('format=') ? diskStr.match(/format=(\w+)/)?.[1] : 'raw',
              cache: diskStr.match(/cache=(\w+)/)?.[1],
              iothread: diskStr.includes('iothread=1'),
            })
          }
        })

        Object.keys(config).forEach(key => {
          if (key.match(/^net\d+$/)) {
            const netStr = config[key]

            const parts = String(netStr).split(',')
            const netInfoItem: any = { id: key }

            parts.forEach(part => {
              const [k, v] = part.split('=')

              if (k === 'bridge') netInfoItem.bridge = v
              else if (k === 'tag') netInfoItem.tag = Number(v)
              else if (k === 'firewall') netInfoItem.firewall = v === '1'
              else if (k === 'rate') netInfoItem.rate = Number(v)
              else if (['virtio', 'e1000', 'rtl8139', 'vmxnet3'].includes(k)) {
                netInfoItem.model = k
                netInfoItem.macaddr = v
              }
            })

            networkInfo.push(netInfoItem)
          }
        })

        optionsInfo = {
          onboot: config.onboot === 1 || config.onboot === true,
          protection: config.protection === 1 || config.protection === true,
          startAtBoot: config.onboot === 1 || config.onboot === true,
          startupOrder: config.startup || 'order=any',
          ostype: config.ostype || 'other',
          bootOrder: config.boot || '',
          useTablet: config.tablet !== 0 && config.tablet !== false,
          hotplug: config.hotplug || 'Disk, Network, USB',
          acpi: config.acpi !== 0 && config.acpi !== false,
          kvmEnabled: config.kvm !== 0 && config.kvm !== false,
          freezeCpu: config.freeze === 1 || config.freeze === true,
          useLocalTime: config.localtime === 1 || config.localtime === true ? 'yes' : 'default',
          rtcStartDate: config.startdate || 'now',
          smbiosUuid: config.smbios1?.match(/uuid=([^,]+)/)?.[1] || 'Auto-generated',
          agentEnabled: config.agent && String(config.agent).includes('enabled=1'),
          spiceEnhancements: config.spice_enhancements || 'none',
          vmStateStorage: config.vmstatestorage || 'Automatic',
          amdSEV: config.sev ? 'enabled' : 'default',
        }
      } catch (e) {
        console.error('Error parsing config:', e)
      }
    }

    return {
      kindLabel: type === 'lxc' ? 'LXC' : 'VM',
      title: name,
      subtitle: `${String(type).toUpperCase()} • ${node} • #${vmid}`,
      breadcrumb: ['Infrastructure', 'Inventaire', 'VM', String(vmid)],
      status: g.status === 'running' ? 'ok' : 'unknown',
      vmRealStatus: g.status,
      tags: vmTags,
      kpis: [{ label: 'State', value: g.status === 'running' ? 'Running' : 'Stopped' }],
      metrics: {
        cpu: { label: 'CPU', pct: c },
        ram: { label: 'RAM', pct: r, used: Number(g.mem ?? 0), max: Number(g.maxmem ?? 0) },
        storage: { label: 'Storage', pct: d, used: Number(g.disk ?? 0), max: Number(g.maxdisk ?? 0) },
      },
      properties: [],
      lastUpdated,
      isCluster,
      vmType: type as 'qemu' | 'lxc',
      name,
      description,
      cpuInfo: cpuInfoVal,
      memoryInfo,
      disksInfo,
      networkInfo,
      optionsInfo,
      nodeCapacity,
    }
  }

  if (sel.type === 'pbs') {
    const pbsId = sel.id

    const [connR, statusR, datastoresR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(pbsId)}`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = pbsId
    let statusData: any = null
    let datastoresData: any[] = []

    if (connR && connR.ok) {
      try {
        const json = await connR.json()
        connName = json?.name || json?.data?.name || pbsId
      } catch {}
    }

    if (statusR && statusR.ok) {
      try {
        const json = await statusR.json()
        statusData = json?.data || json
      } catch {}
    }

    if (datastoresR && datastoresR.ok) {
      try {
        const json = await datastoresR.json()
        datastoresData = json?.data || []
      } catch {}
    }

    let rrdData: any[] = []
    try {
      const rrdR = await fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/rrd?timeframe=hour`, { cache: 'no-store' })
      if (rrdR.ok) {
        const json = await rrdR.json()
        rrdData = json?.data || []
      }
    } catch {}

    const totalSize = statusData?.totalSize || 0
    const totalUsed = statusData?.totalUsed || 0
    const usagePercent = totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0

    let totalBackups = 0
    let totalVms = 0
    let totalCts = 0

    for (const ds of datastoresData) {
      totalBackups += ds.backupCount || 0
      totalVms += ds.vmCount || 0
      totalCts += ds.ctCount || 0
    }

    return {
      kindLabel: 'PBS',
      title: connName,
      subtitle: statusData?.version ? `Proxmox Backup Server ${statusData.version}` : 'Proxmox Backup Server',
      breadcrumb: ['Infrastructure', 'Inventaire', 'PBS', connName],
      status: statusData ? 'ok' : 'crit',
      tags: [],
      kpis: [
        { label: 'Datastores', value: String(datastoresData.length) },
        { label: 'Backups', value: String(totalBackups) },
        { label: 'VMs', value: String(totalVms) },
        { label: 'CTs', value: String(totalCts) },
      ],
      metrics: {
        storage: { label: 'Storage', pct: usagePercent, used: totalUsed, max: totalSize },
      },
      properties: [],
      lastUpdated,
      pbsInfo: {
        version: statusData?.version,
        uptime: statusData?.uptime,
        cpuInfo: statusData?.cpuInfo,
        memory: statusData?.memory,
        load: statusData?.load,
        datastores: datastoresData,
        backups: [],
        stats: { total: totalBackups, vmCount: totalVms, ctCount: totalCts },
        rrdData,
      },
    }
  }

  if (sel.type === 'datastore') {
    const [pbsId, datastoreName] = sel.id.split(':')

    const [connR, datastoresR, backupsR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(pbsId)}`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/pbs/${encodeURIComponent(pbsId)}/backups?datastore=${encodeURIComponent(datastoreName)}&pageSize=5000`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = pbsId
    let datastoreData: any = null
    let backupsData: any = null

    if (connR && connR.ok) {
      try {
        const json = await connR.json()
        connName = json?.name || json?.data?.name || pbsId
      } catch {}
    }

    if (datastoresR && datastoresR.ok) {
      try {
        const json = await datastoresR.json()
        const datastores = json?.data || []
        datastoreData = datastores.find((ds: any) => ds.name === datastoreName) || null
      } catch {}
    }

    if (backupsR && backupsR.ok) {
      try {
        const json = await backupsR.json()
        backupsData = json?.data || null
      } catch {}
    }

    let rrdData: any[] = []
    try {
      const rrdR = await fetch(
        `/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores/${encodeURIComponent(datastoreName)}/rrd?timeframe=hour`,
        { cache: 'no-store' }
      )
      if (rrdR.ok) {
        const json = await rrdR.json()
        rrdData = json?.data || []
      }
    } catch {}

    const total = datastoreData?.total || 0
    const used = datastoreData?.used || 0
    const usagePercent = total > 0 ? Math.round((used / total) * 100) : 0

    return {
      kindLabel: 'DATASTORE',
      title: datastoreName,
      subtitle: connName,
      breadcrumb: ['Infrastructure', 'Inventaire', 'PBS', connName, datastoreName],
      status: 'ok',
      tags: [],
      kpis: [
        { label: 'Backups', value: backupsData?.stats?.total || 0 },
        { label: 'VMs', value: backupsData?.stats?.vmCount || 0 },
        { label: 'CTs', value: backupsData?.stats?.ctCount || 0 },
        { label: 'Size', value: backupsData?.stats?.totalSizeFormatted || '0 B' },
      ],
      metrics: {
        storage: { label: 'Storage', pct: usagePercent, used, max: total },
      },
      properties: [],
      lastUpdated,
      datastoreInfo: {
        pbsId,
        pbsName: connName,
        name: datastoreName,
        path: datastoreData?.path || '',
        comment: datastoreData?.comment || '',
        total,
        used,
        available: datastoreData?.available || 0,
        usagePercent,
        gcStatus: datastoreData?.gcStatus,
        verifyStatus: datastoreData?.verifyStatus,
        backups: backupsData?.backups || [],
        stats: backupsData?.stats || {},
        pagination: backupsData?.pagination || {},
        rrdData,
      },
    }
  }

  return {
    kindLabel: 'STORAGE',
    title: sel.id,
    subtitle: 'To implement',
    breadcrumb: ['Infrastructure', 'Inventaire', 'Storage', sel.id],
    status: 'unknown',
    tags: [],
    kpis: [],
    properties: [],
    lastUpdated,
  }
}

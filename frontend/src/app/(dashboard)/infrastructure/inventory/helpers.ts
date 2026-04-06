import type { InventorySelection, DetailsPayload, SeriesPoint, RrdTimeframe, Status } from './types'

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

  for (let i = 0; i < str.length; i++) h = Math.trunc(h * 31 + str.codePointAt(i)!)

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

const osTypeLabels: Record<string, string> = {
  l26: 'Linux 6.x - 2.6 Kernel',
  l24: 'Linux 2.4 Kernel',
  win11: 'Windows 11/2022/2025',
  win10: 'Windows 10/2016/2019',
  win8: 'Windows 8.x/2012/2012r2',
  win7: 'Windows 7/2008r2',
  wvista: 'Windows Vista/2008',
  w2k8: 'Windows Vista/2008',
  w2k3: 'Windows XP/2003',
  wxp: 'Windows XP/2003',
  w2k: 'Windows 2000',
  solaris: 'Solaris Kernel',
  other: 'Other',
}

export function formatOsType(code: string | undefined): string {
  if (!code) return 'Other'
  return osTypeLabels[code] || code
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes

  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }

  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
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

/**
 * Lightweight Markdown-to-HTML converter.
 * Existing HTML tags (e.g. <img>, <a> from Proxmox) pass through untouched.
 * IMPORTANT: the output MUST be sanitized with DOMPurify at every call site.
 */
export function parseMarkdown(md: string): string {
  if (!md) return ''

  // Collect protected blocks (HTML tags, code blocks) so inline markdown
  // transforms (bold, italic…) cannot touch URLs or code content.
  const shields: string[] = []
  const shield = (s: string) => { shields.push(s); return `\uFFFF${shields.length - 1}\uFFFF` }

  // 1. Protect fenced code blocks
  let html = md.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return shield(`<pre><code>${escaped}</code></pre>`)
  })

  // 2. Protect existing HTML tags (e.g. <img src='…'/>, <a href='…'>…</a>)
  html = html.replace(/<[a-z/][^>]*>/gi, tag => shield(tag))

  // 3. Parse tables before inline transforms so | pipes aren't mangled
  html = html.replace(
    /^(\|.+\|)\r?\n(\|[\s:|-]+\|)\r?\n((?:\|.+\|\r?\n?)+)/gm,
    (_, headerRow: string, _separatorRow: string, bodyRows: string) => {
      const parseRow = (row: string) =>
        row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())

      const headers = parseRow(headerRow)
      const thCells = headers.map(h => `<th>${h}</th>`).join('')

      const rows = bodyRows.trim().split('\n')
      const tbodyRows = rows.map(row => {
        const cells = parseRow(row)
        return `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`
      }).join('')

      return `<table><thead><tr>${thCells}</tr></thead><tbody>${tbodyRows}</tbody></table>`
    }
  )

  // 4. Inline & block transforms (safe: HTML tags are shielded)
  html = html
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      if (/^https?:\/\//i.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
      return text
    })
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      if (/^https?:\/\//i.test(url)) return `<img src="${url}" alt="${alt}" style="max-width: 100%;" />`
      return alt
    })
    .replace(/^---$/gm, '<hr />')
    .replace(/^\*\*\*$/gm, '<hr />')
    .replace(/^> (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[\*\-] (.*)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.*)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br />')

  html = html.replace(/(<li>.*?<\/li>)+/g, '<ul>$&</ul>')

  // 5. Restore all shielded blocks
  html = html.replace(/\uFFFF(\d+)\uFFFF/g, (_, i) => shields[Number(i)])

  if (!html.startsWith('<')) {
    html = '<p>' + html + '</p>'
  }

  return html
}

export const markdownSx = {
  '& a': { color: 'primary.main' },
  '& img': { maxWidth: '100%', height: 'auto' },
  '& table': { borderCollapse: 'collapse', width: '100%', my: 1 },
  '& th, & td': { border: '1px solid', borderColor: 'divider', p: 1, textAlign: 'left' },
  '& th': { fontWeight: 600, bgcolor: 'action.hover' },
  '& h1': { fontSize: '1.8em', fontWeight: 700, mt: 2, mb: 1 },
  '& h2': { fontSize: '1.5em', fontWeight: 700, mt: 2, mb: 1 },
  '& h3': { fontSize: '1.2em', fontWeight: 700, mt: 1.5, mb: 0.5 },
  '& p': { my: 1 },
  '& ul, & ol': { pl: 3, my: 1 },
  '& li': { my: 0.5 },
  '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.9em' },
  '& pre': { bgcolor: 'grey.900', p: 2, borderRadius: 1, overflow: 'auto', '& code': { bgcolor: 'transparent', p: 0 } },
  '& blockquote': { borderLeft: '4px solid', borderColor: 'primary.main', pl: 2, ml: 0, opacity: 0.8, fontStyle: 'italic' },
  '& hr': { border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 2 },
} as const

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
  if (l.includes('ram') || l.includes('memory')) return 'ri-ram-line'
  if (l.includes('storage') || l.includes('stockage') || l.includes('hd') || l.includes('disk')) return 'ri-hard-drive-2-line'
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

    // Extended metrics (node-level, from PVE rrddata)
    const iowaitRaw = pickNumber(p, ['iowait', 'io_wait'])
    const iowait = iowaitRaw != null ? Math.max(0, Math.min(100, iowaitRaw <= 1.5 ? iowaitRaw * 100 : iowaitRaw)) : undefined

    const memAvailable = pickNumber(p, ['memavailable', 'mem_available'])
    const arcSize = pickNumber(p, ['arcsize', 'arc_size', 'zfs_arcsize'])

    // PSI (Pressure Stall Information) - values are percentages (0-100)
    const psiCpuSome = pickNumber(p, ['cpu_some', 'psi_cpu_some']) ?? undefined
    const psiCpuFull = pickNumber(p, ['cpu_full', 'psi_cpu_full']) ?? undefined
    const psiIoSome = pickNumber(p, ['io_some', 'psi_io_some']) ?? undefined
    const psiIoFull = pickNumber(p, ['io_full', 'psi_io_full']) ?? undefined
    const psiMemSome = pickNumber(p, ['mem_some', 'psi_mem_some']) ?? undefined
    const psiMemFull = pickNumber(p, ['mem_full', 'psi_mem_full']) ?? undefined

    out.push({
      t,
      cpuPct: cpuPctVal,
      ramPct: ramPctVal,
      loadAvg: loadAvg ?? undefined,
      netInBps: netIn ?? undefined,
      netOutBps: netOut ?? undefined,
      diskReadBps: diskRead ?? undefined,
      diskWriteBps: diskWrite ?? undefined,
      iowait,
      memAvailable: memAvailable ?? undefined,
      arcSize: arcSize ?? undefined,
      psiCpuSome,
      psiCpuFull,
      psiIoSome,
      psiIoFull,
      psiMemSome,
      psiMemFull,
    })
  }

  out.sort((a, b) => a.t - b.t)

return out
}

export async function fetchRrd(connectionId: string, path: string, timeframe: RrdTimeframe, signal?: AbortSignal) {
  const url = `/api/v1/connections/${encodeURIComponent(connectionId)}/rrd?path=${encodeURIComponent(path)}&timeframe=${encodeURIComponent(timeframe)}`

  const res = await fetch(url, { cache: 'no-store', signal })
  const json = await res.json()

  if (!res.ok) {
    throw new Error(json?.error || `RRD HTTP ${res.status}`)
  }

  return asArray<any>(safeJson<any>(json))
}

export async function fetchDetails(sel: InventorySelection): Promise<DetailsPayload | null> {
  // Root / section selections don't have details — skip fetching
  if (sel.type === 'root' || sel.type === 'storage-root' || sel.type === 'network-root' || sel.type === 'backup-root' || sel.type === 'migration-root' || sel.type === 'net-conn' || sel.type === 'net-node' || sel.type === 'net-vlan' || sel.type === 'storage-cluster' || sel.type === 'storage-node') return null

  const lastUpdated = new Date().toLocaleString()

  if (sel.type === 'cluster') {
    const [connR, nodesR, resourcesR, cephR, storageR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/resources`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/ceph/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(sel.id)}/storage`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = sel.id
    let cephHealth: string | undefined

    try {
      if (connR.ok) {
        const connData = await connR.json()
        connName = connData?.data?.name || connData?.name || sel.id
      }
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

    let nodesJson: any
    let nodes: any[]
    let guests: any[]
    try {
      nodesJson = await nodesR.json()
      nodes = asArray<any>(safeJson(nodesJson))
    } catch {
      throw new Error('Failed to load cluster data — please retry')
    }
    const connectedNode = nodesJson?.connectedNode || null
    try {
      guests = asArray<any>(safeJson(await resourcesR.json()))
    } catch {
      guests = []
    }

    const onlineNodes = nodes.filter((n: any) => n.status === 'online').length
    const runningVMs = guests.filter((g: any) => g.status === 'running').length
    const totalVMs = guests.length

    let totalCpuWeighted = 0
    let totalCpuCores = 0
    let totalMem = 0
    let totalMaxMem = 0
    let totalDisk = 0
    let totalMaxDisk = 0

    for (const n of nodes) {
      const cores = Number(n.maxcpu ?? 0)
      totalCpuWeighted += Number(n.cpu ?? 0) * cores
      totalCpuCores += cores
      totalMem += Number(n.mem ?? 0)
      totalMaxMem += Number(n.maxmem ?? 0)
    }

    // Aggregate real storage from /storage API (already deduplicated)
    if (storageR?.ok) {
      try {
        const storageJson = await storageR.json()
        const storageList = storageJson.data || []
        for (const s of storageList) {
          totalDisk += Number(s.used ?? 0)
          totalMaxDisk += Number(s.total ?? 0)
        }
      } catch {}
    }

    // Fallback to node rootfs if storage API failed
    if (totalMaxDisk === 0) {
      for (const n of nodes) {
        totalDisk += Number(n.disk ?? 0)
        totalMaxDisk += Number(n.maxdisk ?? 0)
      }
    }

    const avgCpuPct = totalCpuCores > 0 ? Math.round((totalCpuWeighted / totalCpuCores) * 100) : 0
    const memPctVal = totalMaxMem > 0 ? pct(totalMem, totalMaxMem) : 0
    const diskPctVal = totalMaxDisk > 0 ? pct(totalDisk, totalMaxDisk) : 0

    const nodesData = nodes.map((n: any) => {
      const vmCount = guests.filter((g: any) => g.node === n.node).length

      return {
        id: `${sel.id}:${n.node}`,
        connId: sel.id,
        node: n.node,
        name: n.node,
        status: (n.hastate === 'maintenance' || n.maintenance === 'maintenance') ? 'maintenance' as const : n.status === 'online' ? 'online' as const : 'offline' as const,
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
      connectedNode,
      nodesData,
      allVms,
      vmsCount: totalVMs,
      cephHealth,
    }
  }

  if (sel.type === 'node') {
    const { connId, node } = parseNodeId(sel.id)

    // First: fetch nodes list to check if node is online
    const nodesR = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' })
    let nodes: any[]
    try {
      nodes = asArray<any>(safeJson(await nodesR.json()))
    } catch {
      throw new Error('Failed to load node data — please retry')
    }
    const n = nodes.find((x: any) => String(x.node) === String(node))

    if (!n) throw new Error('Node not found')

    const isCluster = nodes.length > 1
    const isOnline = n.status === 'online'

    // If node is offline, return minimal payload immediately (no slow API calls)
    if (!isOnline) {
      return {
        kindLabel: 'HOST',
        title: node,
        subtitle: '',
        breadcrumb: ['Infrastructure', 'Inventaire', node],
        status: 'crit' as Status,
        tags: [],
        kpis: [],
        metrics: {},
        vmsData: [],
        properties: [],
        lastUpdated: '',
        hostInfo: { uptime: 0 },
        isCluster,
      } satisfies DetailsPayload
    }

    // Node is online — fetch all details in parallel
    const [statusR, resourcesR, versionR, subscriptionR, updatesR, maintenanceR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/version`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/apt`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`, { cache: 'no-store' }).catch(() => null),
    ])

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
          isCluster,
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
      isCluster,
    }
  }

  if (sel.type === 'vm') {
    const { connId, node, type, vmid } = parseVmId(sel.id)

    const [resourcesR, nodesR, configR, nodeStatusR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/resources`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`, { cache: 'no-store' }).catch(() => null),
    ])

    let resources: any[]
    let nodes: any[]
    try {
      resources = asArray<any>(safeJson(await resourcesR.json()))
    } catch {
      resources = []
    }
    try {
      nodes = asArray<any>(safeJson(await nodesR.json()))
    } catch {
      throw new Error('Failed to load VM data — please retry')
    }

    let nodeStatusData: any = null
    if (nodeStatusR && nodeStatusR.ok) {
      try {
        const json = await nodeStatusR.json()
        nodeStatusData = json?.data || json
      } catch {}
    }

    const isCluster = nodes.length > 1

    const hostNode = nodes.find((n: any) => n.node === node)
    const nodeCpuInfo = nodeStatusData?.cpuinfo || {}
    const nodeCapacity = {
      maxCpu: hostNode?.maxcpu || 128,
      maxMem: hostNode?.maxmem || 128 * 1024 * 1024 * 1024,
      hostSockets: nodeCpuInfo.sockets || undefined,
      hostCoresPerSocket: nodeCpuInfo.cores || undefined,
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
    let systemInfo: any = {}
    let disksInfo: any[] = []
    let networkInfo: any[] = []
    let otherHardwareInfo: any[] = []
    let optionsInfo: any = {}
    let cloudInitConfig: any = null
    let name = g.name || `VM ${vmid}`
    let description = ''

    if (configR && configR.ok) {
      try {
        const configData = await configR.json()
        const config = configData?.data || configData

        name = config.name || name
        description = config.description || ''

        const pending = config.pending || {}

        // Parse CPU type and flags from cpu field (e.g. "host,flags=+aes;-pcid")
        const cpuRaw = config.cpu || 'kvm64'
        const cpuParts = cpuRaw.split(',')
        const cpuTypeVal = cpuParts[0] || 'kvm64'
        const cpuFlagsMap: Record<string, '+' | '-'> = {}
        const flagsPart = cpuParts.find((p: string) => p.startsWith('flags='))
        if (flagsPart) {
          flagsPart.replaceAll('flags=', '').split(';').forEach((f: string) => {
            if (f.startsWith('+') || f.startsWith('-')) {
              cpuFlagsMap[f.slice(1)] = f[0] as '+' | '-'
            }
          })
        }

        cpuInfoVal = {
          sockets: config.sockets || 1,
          cores: config.cores || 1,
          type: cpuTypeVal,
          flags: cpuFlagsMap,
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
          swap: config.swap ?? 0,
          pending: (pending.memory !== undefined || pending.balloon !== undefined || pending.swap !== undefined) ? {
            memory: pending.memory,
            balloon: pending.balloon,
            swap: pending.swap,
          } : undefined,
        }

        systemInfo = {
          bios: config.bios || 'seabios',
          machine: config.machine || 'i440fx',
          vga: config.vga || 'std',
          scsihw: config.scsihw || 'virtio-scsi-single',
        }

        Object.keys(config).forEach(key => {
          if (key.match(/^(scsi|ide|sata|virtio)\d+$/) || key === 'rootfs' || key.match(/^mp\d+$/)) {
            const diskStr = config[key]

            const parts = String(diskStr).split(',')
            const storagePart = parts[0].split(':')
            const sizeMatch = diskStr.match(/size=(\d+[GMT]?)/i)

            const isCdrom = diskStr.includes('media=cdrom') || storagePart[0] === 'none' || String(diskStr) === 'cdrom'
            const isMountpoint = key === 'rootfs' || key.match(/^mp\d+$/)
            const mountpointMatch = isMountpoint ? diskStr.match(/mp=([^,]+)/) : null

            disksInfo.push({
              id: key,
              storage: storagePart[0] || 'unknown',
              size: isCdrom ? '-' : (sizeMatch ? sizeMatch[1] : 'unknown'),
              format: isCdrom ? 'cdrom' : (diskStr.includes('format=') ? diskStr.match(/format=(\w+)/)?.[1] : 'raw'),
              cache: diskStr.match(/cache=(\w+)/)?.[1],
              iothread: diskStr.includes('iothread=1'),
              discard: diskStr.includes('discard=on'),
              ssd: diskStr.includes('ssd=1'),
              backup: !diskStr.includes('backup=0'),
              replicate: !diskStr.includes('replicate=0'),
              aio: diskStr.match(/aio=(\w+)/)?.[1],
              ro: diskStr.includes('ro=1'),
              mbps_rd: diskStr.match(/mbps_rd=(\d+)/)?.[1] ? Number(diskStr.match(/mbps_rd=(\d+)/)?.[1]) : undefined,
              mbps_wr: diskStr.match(/mbps_wr=(\d+)/)?.[1] ? Number(diskStr.match(/mbps_wr=(\d+)/)?.[1]) : undefined,
              iops_rd: diskStr.match(/iops_rd=(\d+)/)?.[1] ? Number(diskStr.match(/iops_rd=(\d+)/)?.[1]) : undefined,
              iops_wr: diskStr.match(/iops_wr=(\d+)/)?.[1] ? Number(diskStr.match(/iops_wr=(\d+)/)?.[1]) : undefined,
              isCdrom,
              mountpoint: mountpointMatch?.[1] || (key === 'rootfs' ? '/' : undefined),
              rawValue: String(diskStr),
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
              else if (k === 'link_down') netInfoItem.linkDown = v === '1'
              else if (k === 'rate') netInfoItem.rate = Number(v)
              else if (k === 'mtu') netInfoItem.mtu = Number(v)
              else if (k === 'queues') netInfoItem.queues = Number(v)
              else if (['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3'].includes(k)) {
                netInfoItem.model = k
                netInfoItem.macaddr = v
              }
            })

            networkInfo.push(netInfoItem)
          }
        })

        // Parse unused disks (unused0, unused1, ...)
        Object.keys(config).forEach(key => {
          if (key.match(/^unused\d+$/)) {
            disksInfo.push({
              id: key,
              storage: String(config[key]).split(':')[0] || 'unknown',
              size: '-',
              format: '-',
              isUnused: true,
              rawValue: String(config[key]),
            })
          }
        })

        // Parse EFI disk and TPM state as disks (they are stored on storage)
        Object.keys(config).forEach(key => {
          const val = String(config[key])
          if (/^efidisk\d+$/.test(key)) {
            const storagePart = val.split(',')[0].split(':')
            const sizeMatch = val.match(/size=(\d+[KMG]?)/)
            disksInfo.push({
              id: key,
              storage: storagePart[0] || 'unknown',
              size: sizeMatch ? sizeMatch[1] : '4M',
              format: 'EFI',
              isEfi: true,
              rawValue: val,
            })
          } else if (/^tpmstate\d+$/.test(key)) {
            const storagePart = val.split(',')[0].split(':')
            const versionMatch = val.match(/version=v(\d+\.\d+)/)
            disksInfo.push({
              id: key,
              storage: storagePart[0] || 'unknown',
              size: '4M',
              format: versionMatch ? `TPM v${versionMatch[1]}` : 'TPM',
              isTpm: true,
              rawValue: val,
            })
          }
        })

        // Parse other hardware: USB, PCI passthrough, serial ports, audio, RNG
        Object.keys(config).forEach(key => {
          const val = String(config[key])
          if (/^usb\d+$/.test(key)) {
            const hostMatch = val.match(/host=([^,]+)/)
            const isSpice = val.includes('spice')
            otherHardwareInfo.push({
              id: key,
              type: 'usb',
              label: isSpice ? 'USB (SPICE)' : `USB${hostMatch ? ` (${hostMatch[1]})` : ''}`,
              rawValue: val,
            })
          } else if (/^hostpci\d+$/.test(key)) {
            const deviceMatch = val.match(/^([^,]+)/)
            otherHardwareInfo.push({
              id: key,
              type: 'pci',
              label: `PCI${deviceMatch ? ` (${deviceMatch[1]})` : ''}`,
              rawValue: val,
            })
          } else if (/^serial\d+$/.test(key)) {
            otherHardwareInfo.push({
              id: key,
              type: 'serial',
              label: `Serial Port`,
              rawValue: val,
            })
          } else if (/^audio\d+$/.test(key)) {
            const deviceMatch = val.match(/device=([^,]+)/)
            const driverMatch = val.match(/driver=([^,]+)/)
            otherHardwareInfo.push({
              id: key,
              type: 'audio',
              label: `Audio${deviceMatch ? ` (${deviceMatch[1]})` : ''}`,
              rawValue: val,
            })
          } else if (key === 'rng0') {
            otherHardwareInfo.push({
              id: key,
              type: 'rng' as any,
              label: 'VirtIO RNG',
              rawValue: val,
            })
          }
        })

        optionsInfo = {
          scsihw: config.scsihw || 'virtio-scsi-single',
          onboot: config.onboot === 1 || config.onboot === true,
          protection: config.protection === 1 || config.protection === true,
          startAtBoot: config.onboot === 1 || config.onboot === true,
          startupOrder: config.startup || 'order=any',
          ostype: config.ostype || 'other',
          bootOrder: config.boot || '',
          useTablet: config.tablet !== 0 && config.tablet !== false,
          hotplug: config.hotplug === 1 || config.hotplug === '1' ? 'disk,network,usb,memory,cpu' : (typeof config.hotplug === 'string' ? config.hotplug.toLowerCase() : 'disk,network,usb'),
          acpi: config.acpi !== 0 && config.acpi !== false,
          kvmEnabled: config.kvm !== 0 && config.kvm !== false,
          freezeCpu: config.freeze === 1 || config.freeze === true,
          useLocalTime: config.localtime === 1 || config.localtime === true ? 'yes' : 'default',
          rtcStartDate: config.startdate || 'now',
          smbiosUuid: config.smbios1?.match(/uuid=([^,]+)/)?.[1] || 'Auto-generated',
          agentEnabled: config.agent && (String(config.agent).startsWith('1') || String(config.agent).includes('enabled=1')),
          spiceEnhancements: config.spice_enhancements || 'none',
          vmStateStorage: config.vmstatestorage || 'Automatic',
          amdSEV: config.sev ? 'enabled' : 'default',
        }

        // Cloud-Init extraction
        const ciFields: Record<string, any> = {}
        let hasCloudInit = false

        if (config.ciuser !== undefined) { ciFields.ciuser = config.ciuser; hasCloudInit = true }
        if (config.cipassword !== undefined) { ciFields.cipassword = '********'; hasCloudInit = true }
        if (config.citype !== undefined) { ciFields.citype = config.citype; hasCloudInit = true }
        if (config.nameserver !== undefined) { ciFields.nameserver = config.nameserver; hasCloudInit = true }
        if (config.searchdomain !== undefined) { ciFields.searchdomain = config.searchdomain; hasCloudInit = true }
        if (config.cicustom !== undefined) { ciFields.cicustom = config.cicustom; hasCloudInit = true }
        if (config.sshkeys !== undefined) {
          try { ciFields.sshkeys = decodeURIComponent(config.sshkeys) } catch { ciFields.sshkeys = config.sshkeys }
          hasCloudInit = true
        }

        const ipconfigs: Record<string, string> = {}
        Object.keys(config).forEach(key => {
          if (/^ipconfig\d+$/.test(key)) {
            ipconfigs[key] = config[key]
            hasCloudInit = true
          }
        })
        if (Object.keys(ipconfigs).length > 0) ciFields.ipconfigs = ipconfigs

        // Detect cloud-init drive in disks
        const allDiskKeys = Object.keys(config).filter(k => /^(scsi|ide|sata|virtio)\d+$/.test(k))
        for (const dk of allDiskKeys) {
          if (String(config[dk]).includes('cloudinit')) {
            ciFields.drive = dk
            hasCloudInit = true
            break
          }
        }

        cloudInitConfig = hasCloudInit ? ciFields : null
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
      isTemplate: g.template === 1 || g.template === true,
      name,
      description,
      cpuInfo: cpuInfoVal,
      memoryInfo,
      systemInfo,
      disksInfo,
      networkInfo,
      otherHardwareInfo,
      optionsInfo,
      cloudInitConfig,
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

  // External hypervisor type category (VMware ESXi, XCP-ng)
  if (sel.type === 'ext-type') {
    const hypervisorType = sel.id // 'vmware' or 'xcpng'
    const label = hypervisorType === 'vmware' ? 'VMware ESXi' : hypervisorType === 'xcpng' ? 'XCP-ng' : hypervisorType === 'nutanix' ? 'Nutanix AHV' : hypervisorType === 'hyperv' ? 'Microsoft Hyper-V' : hypervisorType.toUpperCase()
    const apiPrefix = hypervisorType === 'xcpng' ? 'xcpng' : hypervisorType === 'nutanix' ? 'nutanix' : 'vmware'

    // Fetch all connections of this type
    const connsR = await fetch('/api/v1/connections', { cache: 'no-store' }).catch(() => null)
    const connsData = connsR?.ok ? await connsR.json().catch(() => ({})) : {}
    const allConns = (connsData?.data || []).filter((c: any) => c.type === hypervisorType)

    // Fetch VMs for each connection in parallel
    const hostsWithVms = await Promise.all(
      allConns.map(async (conn: any) => {
        try {
          const vmsR = await fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(conn.id)}/vms`, { cache: 'no-store' })
          const vmsData = vmsR.ok ? await vmsR.json().catch(() => ({})) : {}
          return {
            connectionId: conn.id,
            connectionName: conn.name || conn.id,
            baseUrl: conn.baseUrl || '',
            vms: vmsData?.data?.vms || [],
          }
        } catch {
          return { connectionId: conn.id, connectionName: conn.name || conn.id, baseUrl: conn.baseUrl || '', vms: [] }
        }
      })
    )

    const allVms = hostsWithVms.flatMap(h => h.vms)
    const runningVms = allVms.filter((v: any) => v.status === 'running').length

    // Fetch migration history for all connections of this type
    const connIds = new Set(allConns.map((c: any) => c.id))
    const migsR = await fetch('/api/v1/migrations', { cache: 'no-store' }).catch(() => null)
    const migsData = migsR?.ok ? await migsR.json().catch(() => ({})) : {}
    const migrations = ((migsData?.data || []) as any[]).filter((j: any) => connIds.has(j.sourceConnectionId))

    return {
      kindLabel: label.toUpperCase(),
      title: label,
      subtitle: `${allConns.length} host${allConns.length > 1 ? 's' : ''}`,
      breadcrumb: ['Infrastructure', 'Inventaire', label],
      status: 'ok' as Status,
      tags: [],
      kpis: [
        { label: 'Hosts', value: `${allConns.length}` },
        { label: 'VMs', value: `${allVms.length}` },
        { label: 'Running', value: `${runningVms}` },
        { label: 'Stopped', value: `${allVms.length - runningVms}` },
      ],
      properties: [],
      lastUpdated: new Date().toISOString(),
      extTypeInfo: {
        hypervisorType,
        label,
        hosts: hostsWithVms,
        migrations,
      },
    }
  }

  // External hypervisor host (VMware ESXi, Hyper-V, XCP-ng)
  if (sel.type === 'ext') {
    const connId = sel.id
    // First fetch the connection to know its type
    const connR = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}`, { cache: 'no-store' })
    const connData = await connR.json().catch(() => ({}))
    const conn = connData?.data || connData || {}
    const apiPrefix = conn.type === 'xcpng' ? 'xcpng' : conn.type === 'nutanix' ? 'nutanix' : 'vmware'

    const [statusR, vmsR] = await Promise.all([
      fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(connId)}/status`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(connId)}/vms`, { cache: 'no-store' }).catch(() => null),
    ])

    const statusData = statusR?.ok ? await statusR.json().catch(() => ({})) : {}
    const vmsData = vmsR?.ok ? await vmsR.json().catch(() => ({})) : {}

    const vms = vmsData?.data?.vms || []
    const runningVms = vms.filter((v: any) => v.status === 'running').length
    const version = statusData?.data?.version

    return {
      kindLabel: conn.type === 'vmware' ? 'VMWARE ESXI' : conn.type === 'nutanix' ? 'NUTANIX AHV' : conn.type?.toUpperCase() || 'HYPERVISOR',
      title: conn.name || connId,
      subtitle: version || conn.baseUrl || '',
      breadcrumb: ['Infrastructure', 'Inventaire', conn.name || connId],
      status: (statusData?.data?.status === 'online' ? 'ok' : 'crit') as Status,
      tags: [],
      kpis: [
        { label: 'VMs', value: `${vms.length}` },
        { label: 'Running', value: `${runningVms}` },
        { label: 'Stopped', value: `${vms.length - runningVms}` },
      ],
      properties: [
        ...(version ? [{ k: 'Version', v: version }] : []),
        { k: 'URL', v: conn.baseUrl || '' },
        ...(conn.insecureTLS ? [{ k: 'TLS', v: 'Insecure (self-signed)' }] : []),
      ],
      lastUpdated,
      esxiHostInfo: {
        connectionId: connId,
        connectionName: conn.name || connId,
        hostType: conn.type || 'vmware',
        baseUrl: conn.baseUrl || '',
        version,
        licenseFull: statusData?.data?.licenseFull ?? false,
        vms,
      },
    }
  }

  // External hypervisor VM detail
  if (sel.type === 'extvm') {
    const [connId, ...vmidParts] = sel.id.split(':')
    const vmid = vmidParts.join(':')

    // Determine API prefix from connection type
    const connTypeR = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}`, { cache: 'no-store' }).catch(() => null)
    const connTypeData = connTypeR?.ok ? await connTypeR.json().catch(() => ({})) : {}
    const connType = connTypeData?.data?.type || connTypeData?.type || 'vmware'
    const apiPrefix = connType === 'xcpng' ? 'xcpng' : connType === 'nutanix' ? 'nutanix' : connType === 'hyperv' ? 'hyperv' : 'vmware'

    const [vmR, statusR] = await Promise.all([
      fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(connId)}/vms/${encodeURIComponent(vmid)}`, { cache: 'no-store' }),
      fetch(`/api/v1/${apiPrefix}/${encodeURIComponent(connId)}/status`, { cache: 'no-store' }).catch(() => null),
    ])
    const vmJson = await vmR.json().catch(() => ({}))
    const vm = vmJson?.data || {}
    const statusJson = statusR?.ok ? await statusR.json().catch(() => ({})) : {}
    vm.licenseFull = statusJson?.data?.licenseFull ?? false

    if (vmR.status === 404) {
      return {
        kindLabel: 'VM',
        title: vmid,
        subtitle: 'Not found',
        breadcrumb: ['Infrastructure', 'Inventaire', vmid],
        status: 'unknown' as Status,
        tags: [],
        kpis: [],
        properties: [],
        lastUpdated,
      }
    }

    const memGB = vm.memoryMB ? (vm.memoryMB / 1024).toFixed(1) : '0'
    const committedGB = vm.committed ? (vm.committed / 1073741824).toFixed(1) : '0'
    const provisionedGB = vm.provisioned ? (vm.provisioned / 1073741824).toFixed(1) : '0'

    return {
      kindLabel: connType === 'xcpng' ? '' : connType === 'nutanix' ? '' : connType === 'hyperv' ? '' : '',
      title: vm.name || vmid,
      subtitle: vm.guestOS || '',
      breadcrumb: ['Infrastructure', 'Inventaire', vm.connectionName || '', vm.name || vmid],
      status: (vm.status === 'running' ? 'ok' : vm.status === 'suspended' ? 'warn' : 'crit') as Status,
      vmRealStatus: vm.status,
      tags: [],
      kpis: [
        { label: 'CPU', value: `${vm.numCPU || 0} vCPU` },
        { label: 'RAM', value: `${memGB} GB` },
        { label: 'Storage', value: `${committedGB} GB used` },
        { label: 'Provisioned', value: `${provisionedGB} GB` },
      ],
      properties: [
        { k: 'Guest OS', v: vm.guestOS || 'N/A' },
        { k: 'Power State', v: vm.powerState || 'N/A' },
        { k: 'VMware Tools', v: vm.toolsStatus || 'N/A' },
        { k: 'Hardware Version', v: vm.vmxVersion || 'N/A' },
        { k: 'Firmware', v: (vm.firmware || 'bios').toUpperCase() },
        { k: 'UUID', v: vm.uuid || 'N/A' },
        ...(vm.ipAddress ? [{ k: 'IP Address', v: vm.ipAddress }] : []),
        ...(vm.hostName ? [{ k: 'Hostname', v: vm.hostName }] : []),
        ...(vm.bootTime ? [{ k: 'Boot Time', v: new Date(vm.bootTime).toLocaleString() }] : []),
        ...(vm.annotation ? [{ k: 'Notes', v: vm.annotation }] : []),
      ],
      lastUpdated,
      esxiVmInfo: { ...vm, hostType: connType },
    }
  }

  // Storage item: id = connId:storageName or connId:storageName:node
  if (sel.type === 'storage') {
    const parts = sel.id.split(':')
    const connId = parts[0]
    const storageName = parts[1]
    const nodeHint = parts[2] || null // null for shared storages

    // Fetch connection info + storage details
    const [connR, storageR, nodesR] = await Promise.all([
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/storage`, { cache: 'no-store' }).catch(() => null),
      fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes`, { cache: 'no-store' }).catch(() => null),
    ])

    let connName = connId
    if (connR?.ok) {
      try {
        const json = await connR.json()
        connName = json?.name || json?.data?.name || connId
      } catch {}
    }

    let storageData: any = null
    if (storageR?.ok) {
      try {
        const json = await storageR.json()
        const storages = json?.data || []
        // Match by storage name (+ node for local storages)
        storageData = storages.find((s: any) =>
          s.storage === storageName && (nodeHint ? s.node === nodeHint : s.shared)
        ) || storages.find((s: any) => s.storage === storageName)
      } catch {}
    }

    // Determine a node to use for content listing
    let contentNode = nodeHint
    if (!contentNode && nodesR?.ok) {
      try {
        const json = await nodesR.json()
        const nodes = asArray<any>(safeJson(json))
        const onlineNode = nodes.find((n: any) => n.status === 'online')
        contentNode = onlineNode?.node || nodes[0]?.node || null
      } catch {}
    }

    // Fetch storage content (volumes, ISOs, etc.)
    let contentItems: any[] = []
    if (contentNode) {
      try {
        const contentR = await fetch(
          `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(contentNode)}/storage/${encodeURIComponent(storageName)}/content`,
          { cache: 'no-store' }
        )
        if (contentR.ok) {
          const json = await contentR.json()
          contentItems = json?.data || []
        }
      } catch {}
    }

    const used = storageData?.used || 0
    const total = storageData?.total || 0
    const usedPct = storageData?.usedPct || (total > 0 ? Math.round((used / total) * 100) : 0)
    const storageType = storageData?.type || 'unknown'
    const shared = storageData?.shared || false
    const content = storageData?.content || []
    const enabled = storageData?.enabled !== false

    const typeLabels: Record<string, string> = {
      rbd: 'Ceph RBD', cephfs: 'CephFS', nfs: 'NFS', cifs: 'SMB/CIFS',
      zfspool: 'ZFS', zfs: 'ZFS over iSCSI', lvm: 'LVM', lvmthin: 'LVM-Thin',
      dir: 'Directory', iscsi: 'iSCSI', iscsidirect: 'iSCSI Direct',
      glusterfs: 'GlusterFS', pbs: 'Proxmox Backup Server',
    }

    return {
      kindLabel: 'STORAGE',
      title: storageName,
      subtitle: `${typeLabels[storageType] || storageType}${shared ? ' (shared)' : ''} — ${connName}`,
      breadcrumb: ['Infrastructure', 'Inventaire', 'Storage', connName, storageName],
      status: enabled ? 'ok' : 'warn',
      tags: content,
      kpis: [
        { label: 'Type', value: typeLabels[storageType] || storageType },
        { label: 'Shared', value: shared ? 'Yes' : 'No' },
        ...(contentNode && !shared ? [{ label: 'Node', value: contentNode }] : []),
        ...(storageData?.nodes?.length > 1 ? [{ label: 'Nodes', value: String(storageData.nodes.length) }] : []),
      ],
      metrics: total > 0 ? {
        storage: { label: 'Storage', pct: usedPct, used, max: total },
      } : undefined,
      properties: [
        ...(storageData?.path ? [{ k: 'Path', v: storageData.path }] : []),
        ...(storageData?.server ? [{ k: 'Server', v: storageData.server }] : []),
        ...(storageData?.pool ? [{ k: 'Pool', v: storageData.pool }] : []),
        ...(storageData?.monhost ? [{ k: 'Monitor Host', v: storageData.monhost }] : []),
        ...(storageData?.nodes ? [{ k: 'Available on', v: storageData.nodes.join(', ') }] : []),
        { k: 'Content types', v: content.join(', ') || 'none' },
      ],
      lastUpdated,
      storageInfo: {
        connId,
        connName,
        storage: storageName,
        node: contentNode || '',
        type: storageType,
        shared,
        content,
        enabled,
        status: enabled ? 'available' : 'disabled',
        used,
        total,
        usedPct,
        path: storageData?.path,
        server: storageData?.server,
        pool: storageData?.pool,
        monhost: storageData?.monhost,
        nodes: storageData?.nodes,
        contentItems,
      },
    }
  }

  return {
    kindLabel: 'UNKNOWN',
    title: sel.id,
    subtitle: '',
    breadcrumb: ['Infrastructure', 'Inventaire', sel.id],
    status: 'ok',
    tags: [],
    kpis: [],
    properties: [],
    lastUpdated,
  }
}

// The drain plan of the demo (roadmap#198): the orchestrator is not there, so
// the dialogs that preview a node drain, a group maintenance or a selection
// migration get a plan built from the demo inventory, with the planner's own
// rules in short: every guest of the drained nodes (or the selection) goes to
// the online node outside them with the most memory left, under the memory
// ceiling, guest memory counted at its maximum; a stopped guest stays unless
// asked for; one that fits nowhere stays, and in a group it blocks the plan.

type DemoNode = { node: string; status?: string; mem?: number; maxmem?: number; cpu?: number; maxcpu?: number }
type DemoGuest = { vmid: number; name?: string; type?: string; node: string; status?: string; template?: boolean; mem?: number; maxmem?: number; cpu?: number; maxcpu?: number }

type DrainRequest = {
  node?: string
  config?: { nodes?: string[]; vmids?: number[]; guest_targets?: Record<string, string>; keep_vmids?: number[]; mem_ceiling_percent?: number; include_stopped?: boolean }
}

type DemoPlanGuest = {
  vmid: number
  name: string
  type: string
  status: 'pending' | 'skipped'
  mode: string
  running: boolean
  ha: boolean
  source_node: string
  target_node?: string
  reason?: string
  kept?: boolean
}

const NOT_ENOUGH = 'not enough memory left on the nodes that may receive it'
const STOPPED_KEPT = 'stopped guest left in place (include stopped guests to move it)'
const KEPT = 'left on the node, as asked'

export function demoDrainPlan(request: DrainRequest | null, nodes: DemoNode[], guests: DemoGuest[]) {
  const config = request?.config ?? {}
  const group = Array.isArray(config.nodes) && config.nodes.length > 1
  const vmids = Array.isArray(config.vmids) ? new Set(config.vmids.map(Number)) : null
  const sources = new Set(group ? config.nodes : request?.node ? [request.node] : [])
  const ceiling = (config.mem_ceiling_percent ?? 90) / 100
  const online = nodes.filter(n => n.status === 'online')
  const candidates = online.map(n => n.node).filter(n => !sources.has(n))
  const load = new Map(online.map(n => [n.node, { mem: n.mem ?? 0, cpu: n.cpu ?? 0, in: 0, out: 0 }]))
  const total = new Map(online.map(n => [n.node, n]))

  const picked = guests.filter(g => !g.template && (vmids ? vmids.has(Number(g.vmid)) : sources.has(g.node)))
  const fits = (node: string, size: number) => {
    const max = total.get(node)?.maxmem ?? 0

    return max > 0 && (load.get(node)!.mem + size) / max <= ceiling
  }
  const roomiest = (from: string, size: number) => candidates
    .filter(n => n !== from && fits(n, size))
    .sort((a, b) => load.get(a)!.mem / (total.get(a)!.maxmem || 1) - load.get(b)!.mem / (total.get(b)!.maxmem || 1))[0]

  const blocked: string[] = []
  const planned = picked.map((g): DemoPlanGuest => {
    const running = g.status === 'running'
    const size = running ? g.maxmem ?? g.mem ?? 0 : 0
    const asked = config.guest_targets?.[String(g.vmid)]
    const target = asked && candidates.includes(asked) && asked !== g.node ? asked : roomiest(g.node, size)
    const base = { vmid: Number(g.vmid), name: g.name ?? String(g.vmid), type: g.type ?? 'qemu', running, ha: false, source_node: g.node }

    if (config.keep_vmids?.includes(Number(g.vmid))) return { ...base, status: 'skipped', mode: 'offline', reason: KEPT, kept: true }
    if (!running && !config.include_stopped) return { ...base, status: 'skipped', mode: 'offline', reason: STOPPED_KEPT, kept: true }
    if (!target) {
      if (group) blocked.push(`${g.type === 'lxc' ? 'CT' : 'VM'} ${g.vmid} (${base.name}): ${NOT_ENOUGH}`)

      return { ...base, status: 'skipped', mode: running ? 'online' : 'offline', reason: NOT_ENOUGH }
    }
    const share = ((g.cpu ?? 0) * (g.maxcpu ?? 1)) / (total.get(target)?.maxcpu || 1)
    const to = load.get(target)!
    const from = load.get(g.node)

    to.mem += size
    to.cpu += share
    to.in++
    if (from) {
      from.mem = Math.max(0, from.mem - size)
      from.out++
    }

    return { ...base, status: 'pending', mode: running ? (g.type === 'lxc' ? 'restart' : 'online') : 'offline', target_node: target }
  })

  const shown = online.filter(n => sources.has(n.node) || candidates.includes(n.node) || planned.some(g => g.source_node === n.node))
  const projection = shown.map(n => {
    const after = load.get(n.node)!

    return {
      node: n.node,
      source: sources.has(n.node),
      mem_total: n.maxmem ?? 0,
      mem_before: n.mem ?? 0,
      mem_after: after.mem,
      cpu_before: n.cpu ?? 0,
      cpu_after: Math.min(1, after.cpu),
      guests_in: after.in,
      guests_out: after.out,
    }
  })

  return {
    node: group ? [...sources].sort((x, y) => x.localeCompare(y)).join(',') : request?.node ?? '',
    guests: planned,
    candidates,
    movable: planned.filter(g => g.status === 'pending').length,
    skipped: planned.filter(g => g.status === 'skipped').length,
    projection,
    ...(group ? { blocked } : {}),
  }
}

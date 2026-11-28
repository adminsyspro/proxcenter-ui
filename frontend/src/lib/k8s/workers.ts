// Worker changes of a deployed cluster: names for new workers, addresses to
// propose, and the worker list sent to the orchestrator. Pure functions; the
// orchestrator checks the result again (addresses, ranges, kept workers).

import type { ProvisionNodeSpec, WorkerLayout } from './provisionOrchestrator'

/** At most this many workers in one change (the orchestrator's own bound). */
export const MAX_WORKERS_PER_CHANGE = 5

function ipToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map(s => (n >>> s) & 255).join('.')
}

function allNodes(layout: WorkerLayout): ProvisionNodeSpec[] {
  return [...layout.controlPlane, ...layout.workers]
}

/**
 * Next free addresses after the highest node address, inside the node subnet,
 * skipping the gateway, the virtual IP and every node address.
 */
export function proposeAddresses(layout: WorkerLayout, count: number, taken: string[] = []): { ip: string; vmid: number }[] {
  const nodes = allNodes(layout)
  const used = new Set([...nodes.map(n => n.ip), layout.gateway, layout.controlPlaneVip ?? '', ...taken])
  const ips = nodes.map(n => ipToInt(n.ip)).filter((n): n is number => n !== null)
  const vmids = nodes.map(n => n.vmid)
  const prefix = layout.subnetPrefix > 0 && layout.subnetPrefix <= 32 ? layout.subnetPrefix : 24
  const base = ips.length > 0 ? Math.max(...ips) : (ipToInt(layout.gateway) ?? 0)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (base & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const out: { ip: string; vmid: number }[] = []
  let ip = base + 1
  let vmid = (vmids.length > 0 ? Math.max(...vmids) : 100) + 1
  while (out.length < count && ip < broadcast) {
    const candidate = intToIp(ip)
    if (!used.has(candidate)) {
      out.push({ ip: candidate, vmid })
      vmid += 1
    }
    ip += 1
  }
  return out
}

/** Names for new workers: <cluster>-worker-<n>, after the highest n in use. */
export function nextWorkerNames(clusterName: string, layout: WorkerLayout, count: number): string[] {
  const prefix = `${clusterName}-worker-`
  const taken = allNodes(layout).map(n => n.name)
  const highest = taken
    .filter(n => n.startsWith(prefix))
    .map(n => Number.parseInt(n.slice(prefix.length), 10))
    .filter(n => Number.isInteger(n))
    .reduce((a, b) => Math.max(a, b), 0)
  return Array.from({ length: count }, (_, i) => `${prefix}${highest + i + 1}`)
}

/** A worker to add: its address, its VMID and, optionally, its own sizing. */
export interface NewWorker {
  ip: string
  vmid: number
  cores?: number
  memory?: number
  disk?: number
}

export type WorkerPlanError = 'nothing_to_change' | 'too_many' | 'not_a_worker'

/**
 * The worker list after adding `add` (addresses chosen by the user) and
 * removing the workers named in `remove`. Control plane nodes cannot be
 * removed this way.
 */
export function planWorkers(
  clusterName: string,
  layout: WorkerLayout,
  add: NewWorker[],
  remove: string[],
): { ok: true; workers: ProvisionNodeSpec[]; added: ProvisionNodeSpec[]; error?: undefined } | { ok: false; error: WorkerPlanError; workers?: undefined; added?: undefined } {
  if (add.length === 0 && remove.length === 0) return { ok: false, error: 'nothing_to_change' }
  if (add.length > MAX_WORKERS_PER_CHANGE) return { ok: false, error: 'too_many' }
  const workerNames = new Set(layout.workers.map(w => w.name))
  if (remove.some(name => !workerNames.has(name))) return { ok: false, error: 'not_a_worker' }
  const names = nextWorkerNames(clusterName, layout, add.length)
  const added: ProvisionNodeSpec[] = add.map((a, i) => ({
    name: names[i], ip: a.ip, vmid: a.vmid,
    ...(a.cores ? { cores: a.cores } : {}),
    ...(a.memory ? { memory: a.memory } : {}),
    ...(a.disk ? { disk: a.disk } : {}),
  }))
  const kept = layout.workers.filter(w => !remove.includes(w.name))
  return { ok: true, workers: [...kept, ...added], added }
}

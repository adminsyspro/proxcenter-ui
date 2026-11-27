// src/lib/k8s/provision/networks.ts
// Pod and service ranges of a cluster to deploy: the defaults of each
// distribution, and the same refusals as the orchestrator
// (internal/provisioning/networks.go) so the wizard reports them at the
// Network step rather than after Deploy. A range that overlaps the network of
// the nodes cannot route: the k3s and RKE2 defaults sit on 10.42.0.0/16.

export interface ClusterRanges { pod: string; service: string }

const RANCHER: ClusterRanges = { pod: '10.42.0.0/16', service: '10.43.0.0/16' }
const UPSTREAM: ClusterRanges = { pod: '10.244.0.0/16', service: '10.96.0.0/12' }

export function defaultRanges(distro: string): ClusterRanges {
  return distro === 'k3s' || distro === 'rke2' ? RANCHER : UPSTREAM
}

/** Talos keeps its own ranges: the wizard shows no field for it. */
export function rangesConfigurable(distro: string): boolean {
  return distro === 'k3s' || distro === 'rke2' || distro === 'kubeadm'
}

interface Block { base: number; size: number }

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
  return n
}

export function parseCidr(cidr: string): Block | null {
  // No leading zero in the prefix ("/08"), as the orchestrator's parser refuses it.
  const m = /^([0-9.]+)\/(\d|[12]\d|3[0-2])$/.exec(cidr.trim())
  if (!m) return null
  const ip = ipToInt(m[1])
  const prefix = Number(m[2])
  if (ip === null || prefix > 32) return null
  const size = 2 ** (32 - prefix)
  return { base: Math.floor(ip / size) * size, size }
}

function overlap(a: Block, b: Block): boolean {
  return a.base < b.base + b.size && b.base < a.base + a.size
}

export type RangeError =
  | { code: 'cidrInvalid'; field: 'pod' | 'service'; cidr: string }
  | { code: 'cidrOverlapNodes'; field: 'pod' | 'service'; cidr: string; nodes: string }
  | { code: 'cidrOverlapEach'; field: 'service' }

export interface RangeInput {
  distro: string
  podCIDR: string
  serviceCIDR: string
  subnetPrefix: number
  nodeIps: string[]
}

/** The ranges in effect: what was typed, else the distribution's default. */
export function effectiveRanges(input: Pick<RangeInput, 'distro' | 'podCIDR' | 'serviceCIDR'>): ClusterRanges {
  const d = defaultRanges(input.distro)
  const configurable = rangesConfigurable(input.distro)
  return {
    pod: configurable && input.podCIDR.trim() ? input.podCIDR.trim() : d.pod,
    service: configurable && input.serviceCIDR.trim() ? input.serviceCIDR.trim() : d.service,
  }
}

export function rangeErrors(input: RangeInput): RangeError[] {
  const ranges = effectiveRanges(input)
  const pod = parseCidr(ranges.pod)
  const service = parseCidr(ranges.service)
  const errors: RangeError[] = []
  if (!pod) errors.push({ code: 'cidrInvalid', field: 'pod', cidr: ranges.pod })
  if (!service) errors.push({ code: 'cidrInvalid', field: 'service', cidr: ranges.service })
  if (pod && service && overlap(pod, service)) errors.push({ code: 'cidrOverlapEach', field: 'service' })

  const prefix = input.subnetPrefix >= 1 && input.subnetPrefix <= 32 ? input.subnetPrefix : 32
  const nodeNets = new Map<string, Block>()
  for (const ip of input.nodeIps) {
    const block = parseCidr(`${ip}/${prefix}`)
    if (!block) continue
    const text = `${[24, 16, 8, 0].map(s => Math.floor(block.base / 2 ** s) % 256).join('.')}/${prefix}`
    nodeNets.set(text, block)
  }
  for (const [text, block] of nodeNets) {
    if (pod && overlap(pod, block) && !errors.some(e => e.field === 'pod')) {
      errors.push({ code: 'cidrOverlapNodes', field: 'pod', cidr: ranges.pod, nodes: text })
    }
    if (service && overlap(service, block) && !errors.some(e => e.field === 'service' && e.code !== 'cidrOverlapEach')) {
      errors.push({ code: 'cidrOverlapNodes', field: 'service', cidr: ranges.service, nodes: text })
    }
  }
  return errors
}

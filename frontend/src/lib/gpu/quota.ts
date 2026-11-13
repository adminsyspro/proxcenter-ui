// GPUs a config points at (#672), read on the GPU collection of the
// connection, so a NIC or a USB controller passed through never counts as a GPU.
import type { ConnectionGpuSnapshot } from './collect'
import { addressMatchesDevice, parseHostpciEntries } from './inventory'

/** GPUs the hostpciN entries of a config point at on a node (mapping or raw address). */
export function countGpuRefs(snap: Pick<ConnectionGpuSnapshot, 'devices'>, node: string, config: Record<string, unknown>): number {
  const gpus = snap.devices.filter(d => d.node === node && d.kind === 'gpu')
  let count = 0
  for (const ref of parseHostpciEntries(config)) {
    const hit = ref.mapping
      ? gpus.some(d => d.mappings.includes(ref.mapping as string))
      : gpus.some(d => ref.addresses.some(a => addressMatchesDevice(a, d)))
    if (hit) count++
  }
  return count
}

/** The hostpciN entries of a body or config, alone. */
export function hostpciEntries(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config ?? {}).filter(([k]) => /^hostpci\d+$/.test(k)))
}

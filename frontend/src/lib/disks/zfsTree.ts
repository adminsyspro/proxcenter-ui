export type VdevRow = {
  name: string
  /** Nesting level, 0 for a top-level vdev. Drives the indent in the UI. */
  depth: number
  state: string | null
  read: number | null
  write: number | null
  cksum: number | null
  isLeaf: boolean
}

function num(v: unknown): number | null {
  if (typeof v !== 'number') return null

  return Number.isFinite(v) ? v : null
}

/**
 * Flatten the `children` tree returned by /nodes/{node}/disks/zfs/{name} into
 * indentable rows.
 *
 * The detail call is the only place this tree exists: the pool LIST response has
 * no children at all (measured on PVE 9.1). Entries carry a `leaf` flag, and a
 * missing flag is treated as a container so we never claim a device is a disk.
 */
export function flattenVdevs(children: unknown, depth = 0): VdevRow[] {
  if (!Array.isArray(children)) return []

  const out: VdevRow[] = []

  for (const child of children) {
    if (!child || typeof child !== 'object') continue
    const c = child as Record<string, unknown>
    const name = typeof c.name === 'string' ? c.name.trim() : ''

    if (name === '') continue

    out.push({
      name,
      depth,
      state: typeof c.state === 'string' ? c.state : null,
      read: num(c.read),
      write: num(c.write),
      cksum: num(c.cksum),
      isLeaf: c.leaf === 1 || c.leaf === true,
    })

    out.push(...flattenVdevs(c.children, depth + 1))
  }

  return out
}

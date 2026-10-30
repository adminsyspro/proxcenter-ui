/**
 * Guest details of the VM inventory export (#1163): guest OS, firmware,
 * machine type, QEMU guest agent, creation date and last boot, the columns an
 * RVTools export carries for a VMware estate.
 *
 * The rows of the inventory carry none of them (/cluster/resources has no
 * config field), so the export asks GET /api/v1/vms for its rows at click
 * time: that route already reads each config and probes the agent with
 * `include=agent`, behind the RBAC and vDC filters of the inventory. Rows go
 * by batches of VMIDS_PER_REQUEST per connection, so no single request reads
 * a whole fleet's configs and runs into the proxy's read timeout.
 *
 * The VirtIO driver version is not here: Proxmox exposes it nowhere.
 */

export const VMIDS_PER_REQUEST = 100
const PARALLEL_REQUESTS = 3

export type GuestDetails = {
  ostype: string | null
  bios: string | null
  machine: string | null
  agentEnabled: boolean
  agentResponding?: boolean
  agentVersion?: string | null
  agentOsName?: string | null
  /** Unix seconds, from the config's `meta: ctime=`. */
  createdAt: number | null
  uptimeSeconds?: number
}

export type DetailGuest = {
  connId: string
  type: string
  node: string
  vmid: string | number
  status: string
}

export function guestDetailsKey(guest: { connId: string; type: string; node: string; vmid: string | number }): string {
  return `${guest.connId}:${guest.type}:${guest.node}:${guest.vmid}`
}

function batches(guests: DetailGuest[]): Array<{ connId: string; vmids: string[] }> {
  const byConnection = new Map<string, Set<string>>()

  for (const guest of guests) {
    if (!guest.connId) continue
    const vmids = byConnection.get(guest.connId) ?? new Set<string>()
    vmids.add(String(guest.vmid))
    byConnection.set(guest.connId, vmids)
  }

  const out: Array<{ connId: string; vmids: string[] }> = []

  for (const [connId, vmids] of byConnection) {
    const list = [...vmids]
    for (let i = 0; i < list.length; i += VMIDS_PER_REQUEST) {
      out.push({ connId, vmids: list.slice(i, i + VMIDS_PER_REQUEST) })
    }
  }

  return out
}

/**
 * Details of the guests, keyed by guestDetailsKey. A batch that fails leaves
 * its guests out: the export then writes blank cells rather than failing.
 */
export async function fetchGuestDetails(
  guests: DetailGuest[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, GuestDetails>> {
  const details = new Map<string, GuestDetails>()
  const queue = batches(guests)

  const worker = async () => {
    for (let batch = queue.shift(); batch; batch = queue.shift()) {
      const params = new URLSearchParams({ connId: batch.connId, vmids: batch.vmids.join(','), include: 'agent' })
      try {
        const res = await fetchImpl(`/api/v1/vms?${params}`)
        if (!res.ok) continue
        const json = await res.json()
        for (const vm of json?.data?.vms ?? []) {
          details.set(guestDetailsKey(vm), vm)
        }
      } catch {
        // Blank cells for this batch, never a failed export.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, queue.length) }, worker))

  return details
}

/** Labels of the Proxmox VM wizard for each QEMU ostype; container ostypes read as they are. */
const QEMU_OS_TYPES: Record<string, string> = {
  l26: 'Linux 2.6 - 6.x',
  l24: 'Linux 2.4',
  win11: 'Windows 11/2022/2025',
  win10: 'Windows 10/2016/2019',
  win8: 'Windows 8.x/2012/2012r2',
  win7: 'Windows 7/2008r2',
  w2k8: 'Windows Vista/2008',
  wvista: 'Windows Vista',
  w2k3: 'Windows 2003',
  w2k: 'Windows 2000',
  wxp: 'Windows XP',
  solaris: 'Solaris',
  other: 'Other',
}

/** What the agent says the guest runs, else the OS type set in Proxmox. */
export function guestOsLabel(type: string, details: GuestDetails | undefined, agentOsName?: string | null): string {
  const name = agentOsName || details?.agentOsName
  if (name) return name
  const ostype = details?.ostype
  if (!ostype) return ''

  return (type === 'qemu' && QEMU_OS_TYPES[ostype]) || ostype
}

export function firmwareLabel(type: string, details: GuestDetails | undefined): string {
  if (type !== 'qemu' || !details) return ''

  return details.bios === 'ovmf' ? 'OVMF (UEFI)' : 'SeaBIOS'
}

/**
 * q35 or i440fx, with the QEMU version it is pinned to: `pc-q35-9.2+pve1`
 * reads `q35 9.2+pve1`. No `machine` is the Proxmox default, i440fx.
 */
export function machineLabel(type: string, details: GuestDetails | undefined): string {
  if (type !== 'qemu' || !details) return ''
  const machine = (details.machine ?? '').split(',')[0]
  const family = machine.includes('q35') ? 'q35' : 'i440fx'
  const pinned = /^pc-(?:q35|i440fx)-(\S+)$/.exec(machine)

  return pinned ? `${family} ${pinned[1]}` : family
}

export function agentStatusLabel(guest: DetailGuest, details: GuestDetails | undefined): string {
  if (guest.type !== 'qemu' || !details) return ''
  if (!details.agentEnabled) return 'Disabled'
  if (guest.status !== 'running') return 'Enabled (VM not running)'

  // Unset: the probe did not fit in the route's time budget.
  if (details.agentResponding === undefined) return 'Unknown'

  return details.agentResponding ? 'Running' : 'Not responding'
}

/** Last boot of a running guest, from its uptime. */
export function lastBootDate(guest: DetailGuest, details: GuestDetails | undefined, now: number): Date | null {
  const uptime = Number(details?.uptimeSeconds) || 0
  if (guest.status !== 'running' || uptime <= 0) return null

  return new Date(now - uptime * 1000)
}

export function createdDate(details: GuestDetails | undefined): Date | null {
  return details?.createdAt ? new Date(details.createdAt * 1000) : null
}

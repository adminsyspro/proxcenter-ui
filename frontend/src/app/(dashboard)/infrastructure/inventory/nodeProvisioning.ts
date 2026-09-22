/**
 * Provisioned (allocated) vCPU and memory totals for a single node — #969.
 *
 * Proxmox already hands us every figure this needs in `/cluster/resources`,
 * so these totals are a pure fold over the node's guests, not a new metric
 * collection. Two sets are produced on purpose: what the node has committed
 * to guests that are *running right now* (the commitment that competes with
 * the live usage the gauge draws) and what it has committed across *every*
 * configured guest (what happens if they all start). Templates never count:
 * they hold a configuration, not a reservation.
 */

export type ProvisioningGuest = {
  status?: string
  template?: boolean
  /** vCPUs configured on the guest (`maxcpu` in /cluster/resources). */
  maxcpu?: number
  /** Memory configured on the guest, in bytes (`maxmem`). */
  maxmem?: number
}

export type NodeCapacity = {
  /**
   * Logical CPUs the node reports (`cpuinfo.cpus`) — threads, not physical
   * cores. The UI states this reference next to the ratio so a 1.5x is not
   * read against the wrong denominator.
   */
  logicalCpus?: number
  /** Installed memory, in bytes. */
  memBytes?: number
}

export type ProvisioningFigure = {
  /** Allocated across running, non-template guests. */
  running: number
  /** Allocated across every non-template guest, whatever its state. */
  all: number
  /** `running / capacity`, or undefined when the node reports no capacity. */
  runningRatio?: number
  /** `all / capacity`, or undefined when the node reports no capacity. */
  allRatio?: number
}

export type NodeProvisioning = {
  vcpu: ProvisioningFigure
  memory: ProvisioningFigure
  guests: { running: number; all: number }
  /** Carried through so the caption can state what the ratios divide by. */
  capacity: { logicalCpus: number; memBytes: number }
}

/** A ratio is only meaningful against a capacity the node actually reported. */
function ratio(allocated: number, capacity: number): number | undefined {
  return capacity > 0 ? allocated / capacity : undefined
}

function num(value: unknown): number {
  const n = Number(value ?? 0)

  return Number.isFinite(n) ? n : 0
}

export function computeNodeProvisioning(
  vms: ProvisioningGuest[] | undefined | null,
  capacity: NodeCapacity
): NodeProvisioning | null {
  const guests = (vms || []).filter(vm => !vm.template)

  // Nothing allocated means nothing to compare: the summary stays as clean as
  // it is today rather than showing a row of zeroes.
  if (guests.length === 0) return null

  const running = guests.filter(vm => vm.status === 'running')

  const sum = (list: ProvisioningGuest[], pick: (vm: ProvisioningGuest) => unknown) =>
    list.reduce((total, vm) => total + num(pick(vm)), 0)

  const vcpuRunning = sum(running, vm => vm.maxcpu)
  const vcpuAll = sum(guests, vm => vm.maxcpu)
  const memRunning = sum(running, vm => vm.maxmem)
  const memAll = sum(guests, vm => vm.maxmem)

  const logicalCpus = num(capacity.logicalCpus)
  const memBytes = num(capacity.memBytes)

  return {
    vcpu: {
      running: vcpuRunning,
      all: vcpuAll,
      runningRatio: ratio(vcpuRunning, logicalCpus),
      allRatio: ratio(vcpuAll, logicalCpus),
    },
    memory: {
      running: memRunning,
      all: memAll,
      runningRatio: ratio(memRunning, memBytes),
      allRatio: ratio(memAll, memBytes),
    },
    guests: { running: running.length, all: guests.length },
    capacity: { logicalCpus, memBytes },
  }
}

/**
 * "1.5×" — two decimals at most, and never a bare "0×" for an allocation that
 * exists but is tiny, which would read as "nothing is provisioned".
 */
export function formatRatio(ratio?: number): string | null {
  if (ratio == null || !Number.isFinite(ratio)) return null
  if (ratio > 0 && ratio < 0.005) return '<0.01×'

  return `${Number(ratio.toFixed(2))}×`
}

export type ProvisioningRow = { label: string; value: string; ratio?: string }

export type ProvisioningLabels = {
  /** Where the gauge marker goes, as a percentage of capacity. May exceed 100. */
  markerPct?: number
  markerLabel?: string
  /** The chip beside the gauge label: the total ratio, absent without capacity. */
  chip?: string
  chipLabel?: string
  /** True once every configured guest together asks for more than the node has. */
  overcommitted: boolean
  tooltip: { title: string; rows: ProvisioningRow[]; capacity?: string }
}

/**
 * Turns the totals into what the Node Summary shows: one chip carrying the
 * overcommit ratio, and a tooltip holding the breakdown. Kept out of the
 * component so the wording is testable without rendering MUI, and so the chip,
 * the tooltip and the marker can never drift apart.
 */
export function describeNodeProvisioning(
  provisioning: NodeProvisioning,
  {
    t,
    formatBytes,
  }: {
    t: (key: string, values?: Record<string, unknown>) => string
    formatBytes: (bytes: number) => string
  }
): { cpu: ProvisioningLabels; memory: ProvisioningLabels } {
  const { vcpu, memory, capacity, guests } = provisioning

  // "1.5x" on its own invites the question "of what?", so the tooltip spells
  // the denominator out while the chip stays bare.
  const ofCapacity = (ratio?: number) => {
    const formatted = formatRatio(ratio)

    return formatted ? t('inventory.provisioning.ratioOfCapacity', { ratio: formatted }) : undefined
  }

  const describe = (
    figure: ProvisioningFigure,
    {
      format,
      titleKey,
      markerKey,
      nodeCapacity,
    }: { format: (value: number) => string; titleKey: string; markerKey: string; nodeCapacity?: string }
  ): ProvisioningLabels => {
    const allRatio = formatRatio(figure.allRatio)

    return {
      markerPct: figure.runningRatio != null ? figure.runningRatio * 100 : undefined,
      markerLabel: figure.runningRatio != null ? t(markerKey, { value: format(figure.running) }) : undefined,
      chip: allRatio ?? undefined,
      chipLabel: allRatio ? t('inventory.provisioning.chipAria', { ratio: allRatio }) : undefined,
      overcommitted: (figure.allRatio ?? 0) > 1,
      tooltip: {
        title: t(titleKey),
        rows: [
          {
            // The guest counts turn an abstract "running" into something the
            // reader can check against the node's own guest list.
            label: t('inventory.provisioning.runningGuests', { count: guests.running }),
            value: format(figure.running),
            ratio: ofCapacity(figure.runningRatio),
          },
          {
            label: t('inventory.provisioning.allGuests', { count: guests.all }),
            value: format(figure.all),
            ratio: ofCapacity(figure.allRatio),
          },
        ],
        capacity: nodeCapacity,
      },
    }
  }

  const vcpuFormat = (value: number) => t('inventory.provisioning.vcpu', { value })

  return {
    cpu: describe(vcpu, {
      format: vcpuFormat,
      titleKey: 'inventory.provisioning.titleCpu',
      markerKey: 'inventory.provisioning.markerCpu',
      nodeCapacity:
        capacity.logicalCpus > 0
          ? t('inventory.provisioning.capacityCpu', { logicalCpus: capacity.logicalCpus })
          : undefined,
    }),
    memory: describe(memory, {
      format: formatBytes,
      titleKey: 'inventory.provisioning.titleMemory',
      markerKey: 'inventory.provisioning.markerMemory',
      nodeCapacity:
        capacity.memBytes > 0
          ? t('inventory.provisioning.capacityMemory', { value: formatBytes(capacity.memBytes) })
          : undefined,
    }),
  }
}

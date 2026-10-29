/**
 * Sizing of the source VM for the virt-v2v `-i disk` paths (Hyper-V, Nutanix).
 *
 * In that mode virt-v2v only sees the disk image, so the libvirt XML it writes
 * carries placeholder hardware (1 vCPU, 2 GB of RAM). The vCenter path already
 * overrides those from the SOAP inspection; this module does the same with
 * what the Hyper-V host (WinRM) or Prism Central reports, so the Proxmox VM
 * matches the source instead of needing a manual fixup after every migration.
 * The disk carries no network card either: the source NICs and their MAC
 * addresses come from the same report, so DHCP reservations, licenses bound
 * to a MAC and the guest's own interface names survive the move.
 */

export interface SourceSizing {
  /** Human label for the job log. */
  source: "Hyper-V" | "Nutanix"
  /** vCPUs, 0 when the source did not report them. */
  cores: number
  /** Memory in MiB, 0 when the source did not report it. */
  memoryMB: number
  /** One entry per source NIC, in order; `mac` absent when unusable. */
  nics: { mac?: string }[]
}

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/**
 * A source MAC in the form Proxmox writes in `netN` (`00:15:5D:63:BE:02`).
 * Hyper-V reports `00155D63BE02`, Prism `50:6b:8d:...`. The all-zero MAC of a
 * Hyper-V adapter never started, and a multicast MAC, which Proxmox refuses,
 * give undefined: the NIC is kept and Proxmox generates its address.
 */
export function normalizeSourceMac(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined
  const hex = raw.replaceAll(/[:-]/g, "")
  if (!/^[0-9a-f]{12}$/i.test(hex) || /^0+$/.test(hex)) return undefined
  if (Number.parseInt(hex.slice(0, 2), 16) % 2 === 1) return undefined

  return hex.toUpperCase().replaceAll(/(..)(?!$)/g, "$1:")
}

function build(
  source: SourceSizing["source"],
  cores: unknown,
  memoryMB: unknown,
  nics: { macAddress: string }[] | undefined,
): SourceSizing | null {
  const sizing: SourceSizing = {
    source,
    cores: positive(cores),
    memoryMB: positive(memoryMB),
    nics: (nics ?? []).map(n => {
      const mac = normalizeSourceMac(n.macAddress)
      return mac ? { mac } : {}
    }),
  }

  return sizing.cores === 0 && sizing.memoryMB === 0 && sizing.nics.length === 0 ? null : sizing
}

/** Hyper-V reports ProcessorCount, the startup memory of a powered-off VM and Get-VMNetworkAdapter. */
export function hypervSourceSizing(
  vm: { cpuCount?: number; memoryMB?: number; networkAdapters?: { macAddress: string }[] } | null | undefined,
): SourceSizing | null {
  return build("Hyper-V", vm?.cpuCount, vm?.memoryMB, vm?.networkAdapters)
}

/** Prism Central reports sockets x vCPUs per socket (flattened), memory_size_mib and nic_list. */
export function nutanixSourceSizing(
  vm: { numCpus?: number; memoryMB?: number; nics?: { macAddress: string }[] } | null | undefined,
): SourceSizing | null {
  return build("Nutanix", vm?.numCpus, vm?.memoryMB, vm?.nics)
}

/**
 * Applies the source sizing to the VM config parsed from the virt-v2v XML,
 * leaving untouched whatever the source did not report, and returns the log
 * line describing the change. virt-v2v -i disk writes a single interface; the
 * source NICs replace it, on the model virt-v2v chose for the converted guest
 * (virtio once its drivers are in, an emulated card otherwise).
 */
export function applySourceSizing(
  vmConfig: { cores: number; memory: number; nics: { model: string; mac?: string }[] },
  sizing: SourceSizing,
): string {
  const cores = sizing.cores || vmConfig.cores
  const memory = sizing.memoryMB || vmConfig.memory
  let line =
    `Overriding virt-v2v defaults with ${sizing.source} source values: ` +
    `cores ${vmConfig.cores}->${cores}, memory ${vmConfig.memory}MB->${memory}MB`

  vmConfig.cores = cores
  vmConfig.memory = memory

  if (sizing.nics.length > 0) {
    const model = vmConfig.nics[0]?.model || "virtio"
    line += `, NICs ${vmConfig.nics.length}->${sizing.nics.length}`
    vmConfig.nics = sizing.nics.map(n => (n.mac ? { model, mac: n.mac } : { model }))
  }

  return line
}

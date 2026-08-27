/**
 * Sizing of the source VM for the virt-v2v `-i disk` paths (Hyper-V, Nutanix).
 *
 * In that mode virt-v2v only sees the disk image, so the libvirt XML it writes
 * carries placeholder hardware (1 vCPU, 2 GB of RAM). The vCenter path already
 * overrides those from the SOAP inspection; this module does the same with
 * what the Hyper-V host (WinRM) or Prism Central reports, so the Proxmox VM
 * matches the source instead of needing a manual fixup after every migration.
 */

export interface SourceSizing {
  /** Human label for the job log. */
  source: "Hyper-V" | "Nutanix"
  /** vCPUs, 0 when the source did not report them. */
  cores: number
  /** Memory in MiB, 0 when the source did not report it. */
  memoryMB: number
}

function positive(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function build(source: SourceSizing["source"], cores: unknown, memoryMB: unknown): SourceSizing | null {
  const sizing = { source, cores: positive(cores), memoryMB: positive(memoryMB) }

  return sizing.cores === 0 && sizing.memoryMB === 0 ? null : sizing
}

/** Hyper-V reports ProcessorCount and the startup memory of a powered-off VM. */
export function hypervSourceSizing(vm: { cpuCount?: number; memoryMB?: number } | null | undefined): SourceSizing | null {
  return build("Hyper-V", vm?.cpuCount, vm?.memoryMB)
}

/** Prism Central reports sockets x vCPUs per socket (flattened) and memory_size_mib. */
export function nutanixSourceSizing(vm: { numCpus?: number; memoryMB?: number } | null | undefined): SourceSizing | null {
  return build("Nutanix", vm?.numCpus, vm?.memoryMB)
}

/**
 * Applies the source sizing to the VM config parsed from the virt-v2v XML,
 * leaving untouched whatever the source did not report, and returns the log
 * line describing the change.
 */
export function applySourceSizing(vmConfig: { cores: number; memory: number }, sizing: SourceSizing): string {
  const cores = sizing.cores || vmConfig.cores
  const memory = sizing.memoryMB || vmConfig.memory
  const line =
    `Overriding virt-v2v defaults with ${sizing.source} source values: ` +
    `cores ${vmConfig.cores}->${cores}, memory ${vmConfig.memory}MB->${memory}MB`

  vmConfig.cores = cores
  vmConfig.memory = memory

  return line
}

/**
 * x86-64 microarchitecture levels of the migrated VM's CPU type, and the
 * guests that need a given level (EL10).
 *
 * RHEL 10 and its rebuilds (AlmaLinux, Rocky Linux, CentOS Stream, Oracle
 * Linux) are built for x86-64-v3: on the Proxmox default CPU type
 * (x86-64-v2-AES) the kernel boots, then /init dies on the first v3
 * instruction and the console stays on "Run /init as init process" (measured
 * on the lab with AlmaLinux 10.1). The migration dialog preselects x86-64-v3
 * for such a guest and warns when a lower model is picked; the preflight warns
 * when a node of the target cluster cannot run that level.
 *
 * Shared by the dialog and the server: no server import here.
 */

/** CPU type the dialog preselects for an EL10 guest. */
export const EL10_CPU_TYPE = "x86-64-v3"

/** Level of the CPU models whose level is fixed; `host`, vendor and custom models depend on the node. */
const MODEL_LEVEL: Record<string, number> = {
  qemu64: 1, kvm64: 1, "x86-64-v2": 2, "x86-64-v2-AES": 2, "x86-64-v3": 3, "x86-64-v4": 4,
}

/** x86-64 level of a Proxmox CPU model, or null when it is not a fixed level (host, EPYC-Rome, custom-…). */
export function cpuModelLevel(model: string | undefined | null): number | null {
  return model && Object.hasOwn(MODEL_LEVEL, model) ? MODEL_LEVEL[model] : null
}

/** True when the model is known to sit below x86-64-v3, where an EL10 guest does not boot. */
export function cpuTooLowForEl10(model: string | undefined | null): boolean {
  const level = cpuModelLevel(model)
  return level !== null && level < 3
}

/** /proc/cpuinfo flags each level adds (the QEMU x86-64-vN models). */
const LEVEL_FLAGS: [number, string[]][] = [
  [2, ["cx16", "lahf_lm", "popcnt", "sse4_1", "sse4_2", "ssse3"]],
  [3, ["avx", "avx2", "bmi1", "bmi2", "f16c", "fma", "abm", "movbe", "xsave"]],
  [4, ["avx512f", "avx512bw", "avx512cd", "avx512dq", "avx512vl"]],
]

/** Highest x86-64 level a node's CPU flags (`/nodes/<n>/status` cpuinfo.flags) can run, 1 to 4. */
export function x86LevelFromFlags(flags: string): number {
  const has = new Set(flags.split(/\s+/).filter(Boolean))
  let level = 1
  for (const [n, needed] of LEVEL_FLAGS) {
    if (!needed.every(f => has.has(f))) break
    level = n
  }
  return level
}

/** The flags a node lacks for a level, for the preflight message. */
export function missingFlagsForLevel(flags: string, level: number): string[] {
  const has = new Set(flags.split(/\s+/).filter(Boolean))
  return LEVEL_FLAGS.filter(([n]) => n <= level).flatMap(([, f]) => f).filter(f => !has.has(f))
}

const EL_FAMILY = /red hat enterprise linux|\brhel\b|almalinux|alma linux|rocky linux|centos stream|oracle linux/i

/** What vSphere says about the guest: guest ids, names, and `guest.guestDetailedData` (vSphere 8.0 U2+). */
export interface GuestIdentity {
  guestId?: string
  guestOS?: string
  detailedData?: string
}

function detailed(data: string, key: string): string {
  return new RegExp(`${key}='([^']*)'`).exec(data)?.[1] ?? ""
}

/**
 * Is this guest an EL10, from what vSphere knows about it?
 *
 * The configured guest id and name rarely say it (AlmaLinux and Rocky have no
 * versioned id, "AlmaLinux (64-bit)"), so the Tools-reported detailed data,
 * kept by vSphere after the guest powers off, decides first. AlmaLinux also
 * ships an x86-64-v2 rebuild of EL10, recognisable by its kernel arch: that
 * one does not count.
 */
export function isEl10Guest(g: GuestIdentity): boolean {
  const data = g.detailedData || ""
  if (data) {
    const kernel = detailed(data, "kernelVersion")
    if (/x86_64_v2\b/.test(kernel)) return false
    const name = `${detailed(data, "distroName")} ${detailed(data, "prettyName")}`
    const major = detailed(data, "distroVersion").split(".")[0]
    if (EL_FAMILY.test(name) && major) return major === "10"
    if (/\.el10/.test(kernel)) return true
  }
  if (/^(rhel|centos|almalinux|rockylinux|oraclelinux)10_64Guest$/i.test(g.guestId || "")) return true
  const os = g.guestOS || ""
  return EL_FAMILY.test(os) && /(^|[^\d.])10(\.\d+)?([^\d.]|$)/.test(os.replace(/\(64-bit\)/i, ""))
}

/**
 * The same verdict from virt-v2v's inspection line, "Converting AlmaLinux
 * release 10.1 (Heliotrope Lion) (redhat-based10.1) to run on KVM": the
 * osinfo short id at the end carries the family and the version.
 */
export function isEl10Inspection(converting: string): boolean {
  return /\((rhel|redhat-based|rocky|almalinux|centos-stream|ol)10[\d.]*\)/i.test(converting)
}

/** Job log line when an EL10 guest is about to land on a CPU type below x86-64-v3. */
export function el10CpuWarning(cpuType: string): string {
  return `This guest is an EL10 (RHEL 10 family), built for x86-64-v3: with the ${cpuType} CPU type it stops at "Run /init as init process". Set the CPU type of the target VM to ${EL10_CPU_TYPE} (or host) before starting it.`
}

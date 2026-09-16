import { prisma } from "@/lib/db/prisma"
import { soapRetrieveServiceContent } from "@/lib/vmware/soap"

/**
 * Source-side go/no-go for the warm path: is the source vSphere old enough that
 * the VDDK installed on the Proxmox node cannot read its disks?
 *
 * Why this exists (#946): a warm run against ESXi 5.5.0 reached the copy and died
 * with `dd: error reading '/dev/nbd0': Input/output error` after zero bytes in 5 ms.
 * Nothing upstream had looked ill: the VDDK opened the disk over SOAP on 443 and
 * reported the right capacity, so nbdkit came up and nbd-client exported a device
 * of the correct size. Only the NFC data channel on 902 refused, because Broadcom
 * supports each VDDK against its own vSphere release and the two before it, and
 * the node carried VDDK 9.1 against a source four generations older.
 *
 * The version was in our hands the whole time: RetrieveServiceContent returns it
 * at login. It was captured and then dropped on the floor, so the operator paid
 * for the full plan (snapshot, volume allocation, thick zeroing) before finding out.
 */

/**
 * Oldest vSphere that any VDDK installable on a Proxmox VE 9 node can read.
 *
 * VDDK 6.5 is the last release Broadcom tested against ESXi 5.5, and it does not
 * run on Debian 13 (it links against the openssl 1.0 era), while nbdkit 1.42
 * dlopens the `libvixDiskLib.so.8` SONAME that only VDDK 8 and later provide.
 * So a source below this floor is not a matter of installing something else:
 * there is no combination that works, and the run must be refused outright.
 */
export const ABSOLUTE_MIN_SOURCE_VERSION = "6.5"

/**
 * Oldest vSphere each VDDK generation is supported against, per Broadcom's N-2
 * rule (a VDDK works with its own release and the two before it). vSphere's
 * majors run 6.0, 6.5, 6.7, 7.0, 8.0, 9.0, which is why the floors are not
 * simply "major minus two".
 */
const VDDK_MIN_SOURCE_VERSION: Record<number, string> = {
  7: "6.5",
  8: "6.7",
  9: "7.0",
}

export interface WarmSourceVersionVerdict {
  /** The source's vSphere API version from RetrieveServiceContent, e.g. "5.5" or "8.0.3.0". Empty when it could not be read. */
  sourceVersion: string
  /** VDDK generation resolved on the node, when the node probe could read it. */
  vddkMajor?: number
  /** Oldest source version this node's VDDK is supported against. */
  minVersion: string
  /** Oldest source ANY VDDK runnable on a PVE 9 node can read; below it the run is refused. */
  absoluteMin: string
  /** No VDDK that runs on this node supports the source: the copy cannot succeed, refuse the run. */
  blocked: boolean
  /** Supported by some VDDK, but outside the matrix of the one installed here: let it run, say so loudly. */
  warning: boolean
}

/**
 * Split a vSphere version string into numeric components, ignoring anything that
 * is not a plain dotted number. vSphere reports "5.5", "6.7.3" and "8.0.3.0"
 * interchangeably, so the comparison has to tolerate a varying component count.
 * Returns null for an empty or unparseable value, which callers treat as
 * "unknown" rather than "old": never block on a reading we did not get.
 */
export function parseVersion(version: string): number[] | null {
  const trimmed = (version || "").trim()
  if (!/^\d+(\.\d+)*$/.test(trimmed)) return null
  return trimmed.split(".").map(Number)
}

/** Compare two dotted version strings; missing components count as 0. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? []
  const pb = parseVersion(b) ?? []
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Read the VDDK generation from the real library file the node resolved.
 *
 * The node probe follows the `libvixDiskLib.so.8` SONAME that nbdkit actually
 * dlopens, so what arrives here is the resolved target, e.g.
 * `/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9.1.0.0` on a node running
 * VDDK 9.1. The bare `libvixDiskLib.so` and the `.so.8` compatibility symlink we
 * create at provisioning time both point at it, which is exactly why the SONAME
 * alone says nothing about the generation.
 */
export function vddkMajorFromLibPath(libPath: string | undefined): number | undefined {
  const match = /libvixDiskLib\.so\.(\d+)(?:\.|$)/.exec(libPath || "")
  if (!match) return undefined
  const major = Number(match[1])
  return Number.isFinite(major) ? major : undefined
}

/**
 * Decide whether this source can be read by this node's VDDK.
 *
 * Three outcomes rather than two, because they call for different answers:
 * below the absolute floor the run is hopeless and is refused; between the
 * absolute floor and the installed VDDK's own floor it is unsupported by
 * Broadcom but has a real chance of working, so it runs with a warning in the
 * job log; at or above the floor nothing is said.
 */
export function checkWarmSourceVersion(input: {
  /** Source vSphere API version from RetrieveServiceContent. */
  sourceApiVersion: string
  /** Real VDDK library path resolved on the target node, when the probe read one. */
  vddkLibPath?: string
}): WarmSourceVersionVerdict {
  const sourceVersion = (input.sourceApiVersion || "").trim()
  const vddkMajor = vddkMajorFromLibPath(input.vddkLibPath)
  // An unrecognised VDDK falls back to the absolute floor: we still refuse what
  // nothing can read, and we stay quiet about everything else rather than
  // inventing a support matrix for a generation we do not know.
  const matrixMin = (vddkMajor !== undefined && VDDK_MIN_SOURCE_VERSION[vddkMajor]) || ABSOLUTE_MIN_SOURCE_VERSION
  const minVersion = compareVersions(matrixMin, ABSOLUTE_MIN_SOURCE_VERSION) > 0 ? matrixMin : ABSOLUTE_MIN_SOURCE_VERSION

  const base = { sourceVersion, vddkMajor, minVersion, absoluteMin: ABSOLUTE_MIN_SOURCE_VERSION }

  if (parseVersion(sourceVersion) === null) return { ...base, blocked: false, warning: false }
  if (compareVersions(sourceVersion, ABSOLUTE_MIN_SOURCE_VERSION) < 0) return { ...base, blocked: true, warning: false }
  return { ...base, blocked: false, warning: compareVersions(sourceVersion, minVersion) < 0 }
}

/**
 * The refusal the operator reads, in the job log and in the migrate dialog.
 * Names the two versions that disagree and points at the cold path, which reads
 * over HTTPS and never loads the VDDK, so it is unaffected by this floor.
 */
export function warmSourceVersionError(v: WarmSourceVersionVerdict): string {
  return (
    `Warm migration cannot read a vSphere ${v.sourceVersion} source: the VDDK required on a Proxmox VE 9 node ` +
    `supports vSphere ${v.absoluteMin} and later${v.vddkMajor !== undefined ? ` (this node carries VDDK ${v.vddkMajor}.x, supported from vSphere ${v.minVersion})` : ""}. ` +
    `The disk copy would fail with an I/O error after zero bytes. Use a cold migration for this VM: it reads over HTTPS and does not use the VDDK.`
  )
}

/** The warning for a source Broadcom does not support here but that may still work. */
export function warmSourceVersionWarning(v: WarmSourceVersionVerdict): string {
  return (
    `Source is vSphere ${v.sourceVersion}, older than the vSphere ${v.minVersion} this node's VDDK ` +
    `${v.vddkMajor !== undefined ? `(${v.vddkMajor}.x) ` : ""}is supported against. The copy may fail with an I/O error on the first read; ` +
    `a cold migration is unaffected.`
  )
}

/**
 * Read a VMware source's API version for the migrate dialog's go/no-go.
 *
 * RetrieveServiceContent needs no credentials, so this is one unauthenticated
 * HTTPS call rather than a login/logout pair. A source we cannot reach returns
 * an empty version, which checkWarmSourceVersion reads as "unknown" and lets
 * through: this check exists to explain a known-impossible run, never to become
 * a second reason a reachable source is refused.
 */
export async function fetchSourceApiVersion(sourceConnectionId: string): Promise<string> {
  try {
    const conn = await prisma.connection.findUnique({
      where: { id: sourceConnectionId },
      select: { baseUrl: true, insecureTLS: true, type: true },
    })
    if (!conn || conn.type !== "vmware") return ""
    const sc = await soapRetrieveServiceContent(conn.baseUrl.replace(/\/$/, ""), conn.insecureTLS)
    return sc.apiVersion || ""
  } catch {
    return ""
  }
}

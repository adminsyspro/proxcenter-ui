// src/lib/migration/xen-pv-drivers.ts
//
// Windows guests from a XAPI pool (XenServer, XCP-ng) carry the Xen PV drivers
// of their VM Tools. Off Xen they bring the guest down at first boot: XENFILT
// sits in the UpperFilters of the System and HDC device classes, xenbus,
// xenfilt and xenvbd start with the kernel, and xen.sys bugchecks with
// 0x0000DEAD, which Windows answers with its Automatic Repair screen (lab
// 09/11/2026, XenServer 8.4 with VM Tools 9.6, warm and offline alike;
// virt-v2v installs the VirtIO drivers but leaves the Xen ones in place).
//
// The fix, applied to the copied boot disk before the target's first boot: every
// Xen PV service present is disabled (Start=4) and XENFILT is taken out of the
// class filter lists. Nothing is uninstalled, so the guest still boots on Xen
// if the disk ever goes back. Only what the registry holds is touched: a guest
// without VM Tools is left as it is.

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { SshTarget } from "@/lib/ssh/node-endpoint-core"

/** Services of the Xen PV driver sets (XenServer / Citrix VM Tools, XCP-ng tools, older GPL PV drivers), lowercase. */
export const XEN_PV_SERVICES = new Set([
  "xenbus", "xenfilt", "xenvbd", "xennet", "xenvif", "xeniface", "xendisk", "xenvkbd", "xenhid", "xencons",
  "xenagent", "xensvc", "xenpci", "xenutil", "xevtchn", "xennet6", "xenbus_monitor",
])

/** Filter drivers that must leave the class filter lists, lowercase. */
const XEN_PV_FILTERS = new Set(["xenfilt"])

const XEN_PV_TIMEOUT_MS = 5 * 60 * 1000

export interface XenPvClassFilter {
  /** Full key of the device class, "HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Control\Class\{...}". */
  key: string
  name: "UpperFilters" | "LowerFilters"
  values: string[]
}

export interface XenPvScan {
  /** Every Xen PV service key, in every control set (the LastKnownGood one included). */
  serviceKeys: string[]
  /** The Xen PV service names found, as the registry spells them, once each. */
  services: string[]
  /** Class filter lists, in every control set, that name a Xen PV filter. */
  filters: XenPvClassFilter[]
}

/**
 * One shell command printing what parseXenPvScan reads: the SYSTEM hive is
 * exported once (one libguestfs appliance, about 8 s), then filtered on the node
 * so only the Xen service keys and the class filter values travel, for every
 * control set: Windows falls back to LastKnownGood after a failed boot.
 * A multi-line value (a `\` at the end of a line) is joined back.
 */
export function xenPvScanCommand(disk: string, format: "raw" | "qcow2"): string {
  const awk = [
    String.raw`/^\[/ { k = $0; lk = tolower(k); if (lk ~ /\\services\\[^\\]+\]$/ && lk ~ /\\services\\(xen|xevtchn)/) print k; next }`,
    String.raw`/^"(UpperFilters|LowerFilters)"=/ { l = $0; while (l ~ /\\$/ && (getline n) > 0) { sub(/\\$/, "", l); sub(/^[ \t]+/, "", n); l = l n }; print k; print l }`,
  ].join("\n")
  return [
    'T=$(mktemp /tmp/proxcenter-xenpv-XXXXXX.reg) || exit 1',
    `LIBGUESTFS_BACKEND=direct virt-win-reg --format=${format} ${shellEscape(disk)} ${shellEscape(String.raw`HKLM\SYSTEM`)} > "$T" 2>/dev/null`,
    "RC=$?",
    `awk ${shellEscape(awk)} "$T"`,
    'rm -f "$T"',
    'echo "XENPV-EXIT=$RC"',
  ].join("; ")
}

/** REG_MULTI_SZ from a .reg `hex(7):..` value. */
function decodeMultiSz(hex: string): string[] {
  const bytes = hex.split(",").map(x => x.trim()).filter(Boolean).map(x => Number.parseInt(x, 16))
  if (bytes.some(b => Number.isNaN(b))) return []
  return Buffer.from(bytes).toString("utf16le").split("\u0000").filter(Boolean)
}

/** A .reg `hex(7):..` value for a REG_MULTI_SZ. */
function encodeMultiSz(values: string[]): string {
  const buf = Buffer.from(values.map(v => `${v}\u0000`).join("") + "\u0000", "utf16le")
  return `hex(7):${[...buf].map(b => b.toString(16).padStart(2, "0")).join(",")}`
}

const SERVICE_KEY_RE = /^\[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet\d{3}\\Services\\([^\\\]]+)\]$/i
const CLASS_KEY_RE = /^\[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet\d{3}\\Control\\Class\\[^\]]+\]$/i
const FILTER_VALUE_RE = /^"(UpperFilters|LowerFilters)"=hex\(7\):(.*)$/

/** The Xen PV service a key line names, null for any other line. */
function xenServiceOf(line: string): string | null {
  const name = SERVICE_KEY_RE.exec(line)?.[1]
  return name && XEN_PV_SERVICES.has(name.toLowerCase()) ? name : null
}

/** The class filter list a key line and its value line hold, when it names a Xen PV filter. */
function xenClassFilterOf(line: string, next: string): XenPvClassFilter | null {
  if (!CLASS_KEY_RE.test(line)) return null
  const m = FILTER_VALUE_RE.exec(next)
  if (!m) return null
  const values = decodeMultiSz(m[2])
  if (!values.some(v => XEN_PV_FILTERS.has(v.toLowerCase()))) return null
  return { key: line.slice(1, -1), name: m[1] as XenPvClassFilter["name"], values }
}

/** What xenPvScanCommand printed, null when virt-win-reg could not read the disk. */
export function parseXenPvScan(output: string): XenPvScan | null {
  if (/XENPV-EXIT=(\d+)/.exec(output)?.[1] !== "0") return null
  const lines = output.split(/\r?\n/)
  const serviceKeys: string[] = []
  const services = new Map<string, string>()
  const filters: XenPvClassFilter[] = []
  for (let i = 0; i < lines.length; i++) {
    const service = xenServiceOf(lines[i])
    if (service) {
      serviceKeys.push(lines[i].slice(1, -1))
      if (!services.has(service.toLowerCase())) services.set(service.toLowerCase(), service)
      continue
    }
    const filter = xenClassFilterOf(lines[i], lines[i + 1] || "")
    if (filter) filters.push(filter)
  }
  return { serviceKeys, services: [...services.values()], filters }
}

/**
 * The .reg file that neutralizes what the scan found, null when the guest has
 * no Xen PV driver. A filter list left empty is deleted rather than kept empty.
 */
export function buildXenPvNeutralizeReg(scan: XenPvScan): string | null {
  if (scan.serviceKeys.length === 0 && scan.filters.length === 0) return null
  const out = ["Windows Registry Editor Version 5.00", ""]
  for (const f of scan.filters) {
    const kept = f.values.filter(v => !XEN_PV_FILTERS.has(v.toLowerCase()))
    out.push(`[${f.key}]`, `"${f.name}"=${kept.length > 0 ? encodeMultiSz(kept) : "-"}`, "")
  }
  for (const key of scan.serviceKeys) out.push(`[${key}]`, `"Start"=dword:00000004`, "")
  return out.join("\r\n")
}

/** One shell command merging `reg` into the disk's registry; prints XENPV-MERGED on success. */
export function xenPvMergeCommand(disk: string, format: "raw" | "qcow2", reg: string): string {
  const b64 = Buffer.from(reg).toString("base64")
  return [
    'F=$(mktemp /tmp/proxcenter-xenpv-XXXXXX.reg) || exit 1',
    `echo ${shellEscape(b64)} | base64 -d > "$F"`,
    `LIBGUESTFS_BACKEND=direct virt-win-reg --merge --format=${format} ${shellEscape(disk)} "$F" 2>&1 && echo XENPV-MERGED`,
    'rm -f "$F"',
  ].join("; ")
}

/**
 * One shell command making the Windows volume of the disk writable, for a merge
 * that hit "Read-only file system": ntfs-3g refuses to write a volume Windows
 * left hibernated (fast startup, a hiberfil.sys) or unclean (hard power off,
 * "Metadata kept in Windows cache"). The hibernation file is dropped first
 * (remove_hiberfile), and ntfsfix resets the journal if the volume is still
 * unsafe, which makes Windows check the disk at its next boot. Prints
 * XENPV-UNLOCK=<steps taken> and XENPV-PROBE=<ntfs-3g.probe code, 0 = writable>.
 */
export function xenPvUnlockCommand(disk: string, format: "raw" | "qcow2"): string {
  const gf = `LIBGUESTFS_BACKEND=direct guestfish --format=${format} -a ${shellEscape(disk)}`
  return [
    `R=$(LIBGUESTFS_BACKEND=direct guestfish --ro --format=${format} -a ${shellEscape(disk)} run : inspect-os 2>/dev/null | head -1)`,
    '[ -n "$R" ] || { echo XENPV-NOROOT; exit 0; }',
    `probe() { ${gf} run : ntfs-3g-probe true "$R" 2>/dev/null | tail -1; }`,
    'S=""; P=$(probe)',
    `if [ "$P" != 0 ]; then ${gf} run : mount-options remove_hiberfile "$R" / : umount-all > /dev/null 2>&1; S="hiberfile"; P=$(probe); fi`,
    `if [ "$P" != 0 ]; then ${gf} run : ntfsfix "$R" > /dev/null 2>&1; S="$S ntfsfix"; P=$(probe); fi`,
    'echo "XENPV-UNLOCK=$S"; echo "XENPV-PROBE=$P"',
  ].join("; ")
}

export interface XenPvNeutralizeResult {
  /** True when the registry was changed. */
  changed: boolean
  /** The Windows volume was not writable as copied: hiberfile dropped, journal reset (Windows checks the disk at first boot). */
  unlocked?: ("hiberfile" | "ntfsfix")[]
  services: string[]
  filters: number
  /** Why nothing could be checked or changed. */
  error?: string
}

/**
 * Disable the Xen PV drivers on the boot disk of a Windows guest copied from a
 * XAPI pool. Never throws: a failure is returned for the caller to log, and the
 * guest is then left exactly as copied.
 */
export async function neutralizeXenPvDrivers(a: {
  connectionId: string
  nodeIp: SshTarget
  /** Block device or image file of the boot disk, not in use by a running VM. */
  disk: string
  format: "raw" | "qcow2"
}): Promise<XenPvNeutralizeResult> {
  try {
    const scanOut = await executeSSH(a.connectionId, a.nodeIp, xenPvScanCommand(a.disk, a.format), XEN_PV_TIMEOUT_MS)
    const scan = scanOut.success ? parseXenPvScan(scanOut.output || "") : null
    if (!scan) return { changed: false, services: [], filters: 0, error: `the Windows registry could not be read (${(scanOut.error || "virt-win-reg failed").trim()})` }
    const reg = buildXenPvNeutralizeReg(scan)
    if (!reg) return { changed: false, services: [], filters: 0 }
    let merge = await executeSSH(a.connectionId, a.nodeIp, xenPvMergeCommand(a.disk, a.format, reg), XEN_PV_TIMEOUT_MS)
    let unlocked: XenPvNeutralizeResult["unlocked"]
    if (!(merge.output || "").includes("XENPV-MERGED") && /read-only file system/i.test(`${merge.output || ""} ${merge.error || ""}`)) {
      const u = await executeSSH(a.connectionId, a.nodeIp, xenPvUnlockCommand(a.disk, a.format), XEN_PV_TIMEOUT_MS)
      const out = u.output || ""
      unlocked = (/XENPV-UNLOCK=(.*)/.exec(out)?.[1] || "").split(/\s+/).filter((s): s is "hiberfile" | "ntfsfix" => s === "hiberfile" || s === "ntfsfix")
      if (/XENPV-PROBE=0\b/.test(out)) merge = await executeSSH(a.connectionId, a.nodeIp, xenPvMergeCommand(a.disk, a.format, reg), XEN_PV_TIMEOUT_MS)
    }
    if (!merge.success || !(merge.output || "").includes("XENPV-MERGED")) {
      const why = (merge.error || merge.output || "virt-win-reg --merge failed").trim().split("\n").slice(-2).join(" ")
      return { changed: false, services: scan.services, filters: scan.filters.length, error: `the Windows registry could not be updated (${why})` }
    }
    return { changed: true, services: scan.services, filters: scan.filters.length, ...(unlocked && unlocked.length > 0 && { unlocked }) }
  } catch (e: any) {
    return { changed: false, services: [], filters: 0, error: String(e?.message || e) }
  }
}

/** The job log line of a neutralization, for both XAPI pipelines. */
export function xenPvLogLine(r: XenPvNeutralizeResult): { msg: string; level: "success" | "info" | "warn" } {
  if (r.error) {
    return {
      msg: `Xen PV drivers: ${r.error}. If the guest stops at first boot with 0x0000DEAD (xen.sys) or the Automatic Repair screen, shut the source down from the guest with fast startup disabled, or uninstall the XenServer / XCP-ng VM Tools on it, and migrate again`,
      level: "warn",
    }
  }
  if (!r.changed) return { msg: "Xen PV drivers: none in this guest, nothing to disable", level: "info" }
  const filters = r.filters > 0 ? ` and XENFILT removed from ${r.filters} device class filter list(s)` : ""
  const unlocked = r.unlocked && r.unlocked.length > 0
    ? ". The Windows volume was not cleanly shut down (fast startup or a hard power off): its hibernation state was dropped and its journal reset to write the registry, so Windows checks the disk at first boot. Disable fast startup and shut the source down from the guest to avoid it"
    : ""
  return {
    msg: `Xen PV drivers disabled for the first boot off Xen (${r.services.join(", ")})${filters}: without this the guest stops with 0x0000DEAD in xen.sys. Uninstall the VM Tools from Programs and Features once the guest runs on Proxmox${unlocked}`,
    level: unlocked ? "warn" : "success",
  }
}

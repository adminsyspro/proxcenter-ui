// src/lib/migration/integrity.ts
//
// Post-copy integrity check of a migrated disk (roadmap#1), shared by the three
// VMware pipelines. Sampled regions (first, last, N spread) are hashed with the
// same tool on the source and on the target, a qcow2 target also goes through
// `qemu-img check`, and any difference fails the job BEFORE the VM is handed
// over. Everything runs on the Proxmox node over SSH; this module only builds
// the scripts, parses their output and decides.
//
// What each pipeline can compare:
//  - cold ESXi direct: the source bytes (SSHFS file or HTTPS range of the
//    datastore file) against the target volume: a true source/target check;
//  - warm: the source disk through the VDDK reader against the target block
//    device, on the final cutover copy only;
//  - cold virt-v2v: virt-v2v rewrites the guest (drivers, bootloader), so the
//    source can never be compared byte for byte. What is checked is the copy
//    virt-v2v's output makes to the final volume (regions), the qcow2
//    structure (`qemu-img check`) and the virtual size against the source.

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { SshTarget } from "@/lib/ssh/node-endpoint-core"
import { NBD_RELEASE_HOLDERS_FN, nbdReleaseHoldersCall } from "./nbd-holders"
import {
  describeSamplePlan, formatBytesShort, planSampleRegions, MIB,
  type IntegritySettings, type SampleRegion,
} from "./integrity-settings"

export type {
  IntegritySettings, SampleRegion,
} from "./integrity-settings"
export { planSampleRegions, DEFAULT_INTEGRITY_SETTINGS } from "./integrity-settings"

/** Where the bytes of one side come from, as the Proxmox node can read them. */
export type RegionSource =
  /** Block device or raw file, read with dd. */
  | { kind: "raw"; path: string }
  /** qcow2 / vmdk image, exposed read-only through qemu-nbd on a free NBD device. */
  | { kind: "image"; path: string; format: "qcow2" | "vmdk" | "raw" }
  /** ESXi datastore file over HTTPS, read with range requests and the SOAP cookie. */
  | { kind: "https"; url: string; cookie: string }

/** Hashing a few regions is seconds; the budget covers a slow datastore link. */
export const INTEGRITY_HASH_TIMEOUT_MS = 60 * 60 * 1000
/** `qemu-img check` walks the refcount tables of the whole image. */
export const QEMU_IMG_CHECK_TIMEOUT_MS = 60 * 60 * 1000

/** The job stops here: the copy is not trusted and the VM is not handed over. */
export class IntegrityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IntegrityError"
  }
}

function hashOneRegion(reader: (region: SampleRegion, tmp: string, err: string) => string, region: SampleRegion): string {
  const tag = `R${region.index}`
  return [
    `T=$(mktemp "\${TMPDIR:-/tmp}/proxcenter-integrity.XXXXXX"); E="$T.err"`,
    `if ${reader(region, "$T", "$E")} && [ "$(stat -c %s "$T" 2>/dev/null)" = "${region.length}" ]; then`,
    `  echo "${tag} $(sha256sum < "$T" | cut -d' ' -f1)"`,
    `else`,
    `  echo "${tag} ERR $(tr '\\n' ' ' < "$E" 2>/dev/null | head -c 200) (got $(stat -c %s "$T" 2>/dev/null || echo 0) bytes of ${region.length})"`,
    `fi`,
    `rm -f "$T" "$E"`,
  ].join("\n")
}

/** dd of one region of a device or file, by byte offset. */
function ddReader(path: string): (region: SampleRegion, tmp: string, err: string) => string {
  return (r, tmp, err) =>
    `dd if=${shellEscape(path)} of="${tmp}" bs=1M iflag=skip_bytes,count_bytes skip=${r.offset} count=${r.length} status=none 2>"${err}"`
}

/**
 * The script that prints `R<index> <sha256>` (or `R<index> ERR <reason>`) for
 * every region of `source`, one line each. Each region is read to a temp file
 * so a short read or a transport error is caught (a pipe into sha256sum would
 * happily hash a truncated read). The image kind attaches the file read-only to
 * the first free NBD device for the duration of the scan and detaches it after.
 */
export function buildRegionHashScript(source: RegionSource, regions: SampleRegion[]): string {
  if (regions.length === 0) return "true"
  switch (source.kind) {
    case "raw":
      return regions.map(r => hashOneRegion(ddReader(source.path), r)).join("\n")
    case "https": {
      const cookie = source.cookie.replaceAll('"', "").replaceAll("'", "")
      const reader = (r: SampleRegion, tmp: string, err: string) =>
        `code=$(curl -sk -b '${cookie}' -r ${r.offset}-${r.offset + r.length - 1} -o "${tmp}" -w '%{http_code}' ${shellEscape(source.url)} 2>"${err}") && [ "$code" = 206 ] || { echo "http_code=$code" >>"${err}"; false; }`
      return regions.map(r => hashOneRegion(reader, r)).join("\n")
    }
    case "image": {
      const lines = [
        "modprobe nbd max_part=0 2>/dev/null",
        NBD_RELEASE_HOLDERS_FN,
        "NBD=",
        "for i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do",
        "  [ -s /sys/block/nbd$i/pid ] && continue",
        `  if err=$(qemu-nbd -r -f ${source.format} -c /dev/nbd$i ${shellEscape(source.path)} 2>&1); then NBD=/dev/nbd$i; break; fi`,
        "done",
        `[ -n "$NBD" ] || { ${regions.map(r => `echo "R${r.index} ERR qemu-nbd attach failed: $err"`).join("; ")}; exit 0; }`,
        // Let the kernel see the size before the first read (qemu-nbd -c returns early).
        "for i in 1 2 3 4 5 6 7 8 9 10; do [ \"$(blockdev --getsize64 \"$NBD\" 2>/dev/null || echo 0)\" != 0 ] && break; sleep 0.5; done",
      ]
      for (const r of regions) lines.push(hashOneRegion(ddReader("$NBD_PLACEHOLDER$"), r).replaceAll(shellEscape("$NBD_PLACEHOLDER$"), '"$NBD"'))
      lines.push(`${nbdReleaseHoldersCall('"$NBD"')} 2>/dev/null; qemu-nbd -d "$NBD" >/dev/null 2>&1 || true`)
      return lines.join("\n")
    }
  }
}

export interface RegionHash {
  hash?: string
  error?: string
}

/** `R<index> <sha256>` / `R<index> ERR <reason>` lines to a map by region index. */
export function parseRegionHashes(output: string): Map<number, RegionHash> {
  const out = new Map<number, RegionHash>()
  for (const line of (output || "").split("\n")) {
    const m = /^R(\d+)\s+(\S+)(?:\s+(.*))?$/.exec(line.trim())
    if (!m) continue
    const index = Number(m[1])
    if (m[2] === "ERR") out.set(index, { error: (m[3] || "unknown error").trim() })
    else if (/^[0-9a-f]{64}$/i.test(m[2])) out.set(index, { hash: m[2].toLowerCase() })
    else out.set(index, { error: `unexpected output: ${line.trim().slice(0, 120)}` })
  }
  return out
}

export interface RegionVerdict {
  matched: SampleRegion[]
  mismatched: Array<{ region: SampleRegion; source: string; target: string }>
  unreadable: Array<{ region: SampleRegion; side: "source" | "target"; reason: string }>
}

/** Pure comparison of the two hash maps over the plan. */
export function compareRegionHashes(regions: SampleRegion[], source: Map<number, RegionHash>, target: Map<number, RegionHash>): RegionVerdict {
  const verdict: RegionVerdict = { matched: [], mismatched: [], unreadable: [] }
  for (const region of regions) {
    const s = source.get(region.index)
    const t = target.get(region.index)
    if (!s?.hash) verdict.unreadable.push({ region, side: "source", reason: s?.error || "no hash printed" })
    if (!t?.hash) verdict.unreadable.push({ region, side: "target", reason: t?.error || "no hash printed" })
    if (!s?.hash || !t?.hash) continue
    if (s.hash === t.hash) verdict.matched.push(region)
    else verdict.mismatched.push({ region, source: s.hash, target: t.hash })
  }
  return verdict
}

/** `qemu-img check` with its exit code on the last line, JSON report on stdout. */
export function buildQemuImgCheckCmd(path: string, format: "qcow2" = "qcow2"): string {
  return `qemu-img check -f ${format} --output=json ${shellEscape(path)} 2>&1; echo "QEMU_IMG_CHECK_RC=$?"`
}

export interface QemuImgCheckReport {
  /** 0 ok, 1 could not run, 2 corruptions, 3 leaks only, 63 checks unsupported. */
  rc: number
  corruptions: number
  leaks: number
  checkErrors: number
  /** Trimmed non-JSON output, for the log when the tool failed. */
  message: string
}

export function parseQemuImgCheck(output: string): QemuImgCheckReport {
  const text = output || ""
  const rcMatch = /QEMU_IMG_CHECK_RC=(\d+)/.exec(text)
  const rc = rcMatch ? Number(rcMatch[1]) : 1
  let json: Record<string, unknown> = {}
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) {
    try { json = JSON.parse(text.slice(start, end + 1)) } catch { json = {} }
  }
  const num = (k: string) => (typeof json[k] === "number" ? (json[k] as number) : 0)
  const message = text.replace(/QEMU_IMG_CHECK_RC=\d+/, "").replace(/\{[\s\S]*\}/, "").trim().slice(0, 300)
  return { rc, corruptions: num("corruptions"), leaks: num("leaks"), checkErrors: num("check-errors"), message }
}

export function buildQemuImgInfoCmd(path: string): string {
  return `qemu-img info --output=json ${shellEscape(path)} 2>&1`
}

export function parseQemuImgInfo(output: string): { format: string; virtualSize: number } | null {
  const text = output || ""
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const json = JSON.parse(text.slice(start, end + 1))
    const virtualSize = Number(json["virtual-size"])
    return { format: String(json.format || ""), virtualSize: Number.isFinite(virtualSize) ? virtualSize : 0 }
  } catch {
    return null
  }
}

// ── Test hook: deliberate corruption of one target region ──
//
// `PROXCENTER_MIGRATION_FAULT=integrity[:diskIndex[:regionIndex]]` makes the
// pipeline overwrite one sampled region of the target right before it is
// hashed, so the blocking behaviour can be proven end to end on a real
// migration. Ignored in production builds.

export interface FaultInjection { diskIndex: number; regionIndex: number }

export function faultInjectionFromEnv(env: NodeJS.ProcessEnv = process.env): FaultInjection | null {
  if (env.NODE_ENV === "production") return null
  const raw = (env.PROXCENTER_MIGRATION_FAULT || "").trim()
  if (!raw) return null
  const m = /^integrity(?::(\d+))?(?::(\d+))?$/.exec(raw)
  if (!m) return null
  return { diskIndex: Number(m[1] ?? 0), regionIndex: Number(m[2] ?? 1) }
}

/** The command that scribbles over `region` of `target`; null when the target kind cannot be written. */
export function buildFaultInjectCmd(target: RegionSource, region: SampleRegion): string | null {
  switch (target.kind) {
    case "raw":
      return `head -c ${region.length} /dev/urandom | dd of=${shellEscape(target.path)} bs=1M oflag=seek_bytes seek=${region.offset} conv=notrunc status=none`
    case "image":
      if (target.format === "vmdk") return null
      return `qemu-io -f ${target.format} -c ${shellEscape(`write -P 0x5a ${region.offset} ${region.length}`)} ${shellEscape(target.path)} >/dev/null`
    case "https":
      return null
  }
}

// ── Orchestration ──

type LogLevel = "info" | "success" | "warn" | "error"

export interface VerifyDiskIntegrityArgs {
  connectionId: string
  nodeIp: SshTarget
  /** 0-based disk index, matched against the fault injection. */
  diskIndex: number
  /** `Disk 1`, as the pipeline's other log lines name it. */
  diskLabel: string
  capacityBytes: number
  /**
   * Bytes to compare the target against, or null when no byte comparison is
   * possible (virt-v2v output): the check then rests on `checkImage` and
   * `expectedVirtualSize` alone and says so in the log.
   */
  source: RegionSource | null
  target: RegionSource
  settings: IntegritySettings
  /** A qcow2 file to run `qemu-img check` on (the target, or the converted image). */
  checkImage?: { path: string; format: "qcow2" }
  /** Virtual size `checkImage` must report (the source disk capacity). */
  expectedVirtualSize?: number
  log: (msg: string, level?: LogLevel) => Promise<void> | void
  fault?: FaultInjection | null
  /** Test seam. */
  exec?: typeof executeSSH
}

export interface IntegrityResult {
  checked: boolean
  regions: number
  matched: number
  elapsedMs: number
  qemuImgCheck: "ok" | "leaks" | "not-run"
}

/**
 * Verify one migrated disk and throw an IntegrityError when it cannot be
 * trusted: a region that differs, a region that could not be read on either
 * side, a corrupt qcow2 structure or a wrong virtual size. The pipelines call
 * this before attaching, booting or otherwise handing the VM over, so a throw
 * takes the job down its normal failure path.
 */
export async function verifyDiskIntegrity(a: VerifyDiskIntegrityArgs): Promise<IntegrityResult> {
  const exec = a.exec ?? executeSSH
  const result: IntegrityResult = { checked: false, regions: 0, matched: 0, elapsedMs: 0, qemuImgCheck: "not-run" }
  if (!a.settings.enabled) {
    await a.log(`Integrity check disabled on the target cluster (Settings > Connections > Migrations tab): ${a.diskLabel} is handed over unverified`, "warn")
    return result
  }
  const t0 = Date.now()
  const regions = planSampleRegions(a.capacityBytes, a.settings)

  if (a.fault && a.fault.diskIndex === a.diskIndex && regions.length > 0) {
    const region = regions[Math.min(a.fault.regionIndex, regions.length - 1)]
    const cmd = buildFaultInjectCmd(a.target, region)
    if (cmd) {
      await exec(a.connectionId, a.nodeIp, cmd, 120_000)
      await a.log(`TEST HOOK (PROXCENTER_MIGRATION_FAULT): overwrote ${formatBytesShort(region.length)} of the target at offset ${formatBytesShort(region.offset)} before the check`, "warn")
    }
  }

  if (a.source) {
    await a.log(`Integrity check, ${a.diskLabel}: hashing ${describeSamplePlan(regions)} on the source and on the target (sha256)...`)
    const [src, dst] = await Promise.all([
      exec(a.connectionId, a.nodeIp, buildRegionHashScript(a.source, regions), INTEGRITY_HASH_TIMEOUT_MS),
      exec(a.connectionId, a.nodeIp, buildRegionHashScript(a.target, regions), INTEGRITY_HASH_TIMEOUT_MS),
    ])
    const verdict = compareRegionHashes(regions, parseRegionHashes(src.output || ""), parseRegionHashes(dst.output || ""))
    result.regions = regions.length
    result.matched = verdict.matched.length
    if (verdict.unreadable.length > 0) {
      const u = verdict.unreadable[0]
      const detail = `${u.side} region at offset ${formatBytesShort(u.region.offset)}: ${u.reason}`
      const transport = u.side === "source" ? (src.error || "") : (dst.error || "")
      throw new IntegrityError(
        `Integrity check could not read the ${detail}${transport ? ` (${transport.trim().slice(0, 200)})` : ""}. ` +
        `The copy of ${a.diskLabel} is not trusted and the VM was not handed over; fix the access and retry, or disable the check on the target cluster (Settings > Connections > Migrations tab).`,
      )
    }
    if (verdict.mismatched.length > 0) {
      const where = verdict.mismatched.map(m => `offset ${formatBytesShort(m.region.offset)} (${formatBytesShort(m.region.length)}, source ${m.source.slice(0, 12)}, target ${m.target.slice(0, 12)})`).join("; ")
      await a.log(`Integrity check FAILED, ${a.diskLabel}: ${verdict.mismatched.length} of ${regions.length} sampled regions differ between source and target: ${where}`, "error")
      throw new IntegrityError(
        `Integrity check failed on ${a.diskLabel}: ${verdict.mismatched.length} of ${regions.length} sampled regions differ between the source and the target (first at offset ${formatBytesShort(verdict.mismatched[0].region.offset)}). The copy is not trusted and the VM was not handed over.`,
      )
    }
    result.checked = true
    const hashed = regions.reduce((s, r) => s + r.length, 0)
    await a.log(`Integrity check passed, ${a.diskLabel}: ${verdict.matched.length}/${regions.length} sampled regions match (${formatBytesShort(hashed)} hashed on each side in ${((Date.now() - t0) / 1000).toFixed(1)} s)`, "success")
  } else {
    await a.log(`Integrity check, ${a.diskLabel}: the guest was rewritten by virt-v2v (drivers injected), so a byte comparison with the source is not possible; checking the image structure and the virtual size instead`)
  }

  if (a.checkImage) {
    const check = await exec(a.connectionId, a.nodeIp, buildQemuImgCheckCmd(a.checkImage.path, a.checkImage.format), QEMU_IMG_CHECK_TIMEOUT_MS)
    const report = parseQemuImgCheck(check.output || "")
    if (report.rc === 2 || report.corruptions > 0) {
      throw new IntegrityError(`qemu-img check found ${report.corruptions} corruption(s) in ${a.diskLabel} (${a.checkImage.path}). The image is not trusted and the VM was not handed over.`)
    }
    if (report.rc !== 0 && report.rc !== 3) {
      throw new IntegrityError(`qemu-img check could not verify ${a.diskLabel} (${a.checkImage.path}): exit ${report.rc}${report.message ? `, ${report.message}` : ""}. The VM was not handed over.`)
    }
    if (report.leaks > 0) {
      result.qemuImgCheck = "leaks"
      await a.log(`qemu-img check, ${a.diskLabel}: no corruption, ${report.leaks} leaked cluster(s) (wasted space only, the data is intact)`, "warn")
    } else {
      result.qemuImgCheck = "ok"
      await a.log(`qemu-img check passed, ${a.diskLabel}: qcow2 structure intact, no corruption`, "success")
    }
    if (a.expectedVirtualSize && a.expectedVirtualSize > 0) {
      const info = parseQemuImgInfo((await exec(a.connectionId, a.nodeIp, buildQemuImgInfoCmd(a.checkImage.path), 120_000)).output || "")
      if (!info) throw new IntegrityError(`qemu-img info could not read ${a.checkImage.path}; the virtual size of ${a.diskLabel} could not be verified and the VM was not handed over.`)
      if (info.virtualSize !== a.expectedVirtualSize) {
        throw new IntegrityError(`${a.diskLabel}: the converted image is ${formatBytesShort(info.virtualSize)} but the source disk is ${formatBytesShort(a.expectedVirtualSize)}. The VM was not handed over.`)
      }
      await a.log(`${a.diskLabel}: virtual size ${formatBytesShort(info.virtualSize)} matches the source disk`, "success")
    }
    result.checked = true
  }

  result.elapsedMs = Date.now() - t0
  return result
}

/** Sum of the bytes every region of a plan reads, for cost estimates in the log. */
export function sampledBytes(capacityBytes: number, settings: IntegritySettings): number {
  return planSampleRegions(capacityBytes, settings).reduce((s, r) => s + r.length, 0)
}

export { MIB }

/**
 * virt-v2v block path (roadmap#1): the converted image is what gets copied to
 * the target device, so that copy is sampled on both sides before the attach.
 * The image format is read rather than assumed; a qcow2 image also goes
 * through `qemu-img check` and must have the source's virtual size, a raw one
 * is held to the source capacity here. Throws on any mismatch.
 */
export async function verifyConvertedImage(a: {
  connectionId: string; nodeIp: SshTarget; diskIndex: number; imagePath: string; devicePath: string
  /** Size to sample when the image cannot be read (the size the copy used). */
  fallbackSizeBytes: number
  /** The source disk's capacity, when vSphere reported it. */
  sourceCapacityBytes?: number
  settings: IntegritySettings; fault?: FaultInjection | null
  log: (msg: string, level?: "info" | "success" | "warn" | "error") => Promise<void>
  /** Injected in tests. */
  exec?: typeof executeSSH
}): Promise<void> {
  const exec = a.exec ?? executeSSH
  const label = `Disk ${a.diskIndex + 1}`
  const info = parseQemuImgInfo((await exec(a.connectionId, a.nodeIp, buildQemuImgInfoCmd(a.imagePath), 120_000)).output || "")
  const format = info?.format === "qcow2" || info?.format === "vmdk" ? info.format : "raw"
  const source: RegionSource = format === "raw" ? { kind: "raw", path: a.imagePath } : { kind: "image", path: a.imagePath, format }
  await verifyDiskIntegrity({
    connectionId: a.connectionId, nodeIp: a.nodeIp, diskIndex: a.diskIndex, diskLabel: label,
    capacityBytes: info?.virtualSize || a.fallbackSizeBytes, source, target: { kind: "raw", path: a.devicePath },
    ...(format === "qcow2" ? { checkImage: { path: a.imagePath, format: "qcow2" as const }, expectedVirtualSize: a.sourceCapacityBytes } : {}),
    settings: a.settings, fault: a.fault, log: a.log, exec,
  })
  if (format === "qcow2" || !a.sourceCapacityBytes || !info) return
  if (info.virtualSize !== a.sourceCapacityBytes) {
    throw new Error(`${label}: the converted image is ${info.virtualSize} bytes but the source disk is ${a.sourceCapacityBytes} bytes; the VM was not handed over.`)
  }
  await a.log(`${label}: converted image size ${(info.virtualSize / 1073741824).toFixed(2)} GB matches the source disk`, "success")
}

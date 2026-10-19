/**
 * Guest conversion at warm cutover (#1000): virt-v2v-in-place on the copied
 * target volumes, once the source is off and the final delta applied.
 *
 * A warm migration copies the guest byte for byte, so it arrives with the
 * drivers it had on vSphere: a Linux initramfs without virtio_scsi, a Windows
 * without viostor/vioscsi. The engine used to choose hardware such a guest can
 * boot from (SATA boot disk, e1000 NIC for Windows), and a BIOS Linux on SCSI
 * fell into the dracut shell. Converting the guest offline, the way the cold
 * virt-v2v pipelines do, lets it boot from VirtIO SCSI with VirtIO NICs.
 *
 * Safety: the conversion never writes to the target volumes directly. Each
 * volume gets a qcow2 overlay (`qemu-img create -b <device>`), virt-v2v-in-place
 * converts the overlays, and only a conversion that succeeded AND installed the
 * VirtIO drivers is committed into the volumes (`qemu-img commit`, a few tens of
 * MB). Anything else drops the overlays: the volumes are exactly the verified
 * copy, and the guest boots on the compatible hardware as before. This holds on
 * every block storage warm supports, thick LVM included, which has no snapshot.
 *
 * Measured on the lab (virt-v2v 2.6.0, PVE 9): 41 to 64 s per guest, overlays
 * of 50 to 110 MB, commit under a second.
 */

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { SshTarget } from "@/lib/ssh/node-endpoint-core"

export { GUEST_CONVERSION_ESTIMATE_SEC } from "./guest-conversion-estimate"

/** Ceiling for one conversion; a guest that takes longer is left unconverted. */
export const GUEST_CONVERSION_TIMEOUT_MS = 30 * 60 * 1000

const POLL_MS = 3000
const COMMIT_TIMEOUT_MS = 15 * 60 * 1000
const VIRTIO_WIN_ISO = "/usr/share/virtio-win/virtio-win.iso"

export type LogLevel = "info" | "success" | "warn" | "error"

/** Working directory of a job's conversion on the node (overlays, domain XML, log). */
export function conversionDir(jobId: string): string {
  return `/tmp/proxcenter-convert-${jobId.replaceAll(/[^A-Za-z0-9_-]/g, "")}`
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

/**
 * Minimal libvirt domain for `virt-v2v-in-place -i libvirtxml`: the firmware
 * (virt-v2v checks it against what it finds in the guest) and one disk per
 * overlay, in target order so disk 0 stays the boot disk.
 */
export function buildConversionXml(a: { name: string; firmware: "efi" | "bios"; overlays: string[]; memoryMB?: number }): string {
  const os = a.firmware === "efi" ? '<os firmware="efi">' : "<os>"
  const disks = a.overlays.map((path, i) => {
    const dev = `sd${String.fromCodePoint(97 + (i % 26))}`
    return `<disk type="file" device="disk"><driver name="qemu" type="qcow2"/><source file="${xmlEscape(path)}"/><target dev="${dev}" bus="scsi"/></disk>`
  })
  return [
    '<domain type="kvm">',
    `<name>${xmlEscape(a.name || "guest")}</name>`,
    `<memory unit="MiB">${Math.max(256, Math.round(a.memoryMB ?? 2048))}</memory>`,
    `${os}<type arch="x86_64" machine="q35">hvm</type></os>`,
    `<devices>${disks.join("")}</devices>`,
    "</domain>",
  ].join("\n")
}

/**
 * The detached script: overlays on the target devices, then the conversion,
 * then the exit code in `<dir>/exit` (90 when an overlay could not be made).
 * `--block-driver virtio-scsi` makes Windows boot-start vioscsi rather than
 * viostor, matching the scsi0 slot the guest gets. `< /dev/null` turns any
 * interactive question (`--root ask` on a multi-root guest) into a failure.
 */
export function buildConversionScript(jobId: string, devices: string[], xml: string): string {
  const dir = conversionDir(jobId)
  const q = shellEscape
  const lines = [
    `D=${q(dir)}`,
    'rm -rf "$D"; mkdir -p "$D" || exit 1',
    `echo ${q(Buffer.from(xml).toString("base64"))} | base64 -d > "$D/guest.xml"`,
    ...devices.map((dev, i) => `qemu-img create -q -f qcow2 -b ${q(dev)} -F raw "$D/disk${i}.qcow2" > "$D/overlay.log" 2>&1 || { echo 90 > "$D/exit"; exit 0; }`),
    'LIBGUESTFS_BACKEND=direct stdbuf -oL virt-v2v-in-place -i libvirtxml "$D/guest.xml" --block-driver virtio-scsi --machine-readable < /dev/null > "$D/v2v.log" 2>&1',
    'echo $? > "$D/exit"',
  ]
  return lines.join("\n")
}

export interface ConversionOutcome {
  ok: boolean
  /** Guest name as virt-v2v inspected it ("Rocky Linux 9.8 (Blue Onyx)"). */
  os?: string
  /** Why the conversion is not used, when ok is false. */
  reason?: string
  /** virt-v2v warnings worth surfacing in the job log. */
  warnings: string[]
}

interface V2vMessage { type: string; message: string }

function readMessages(log: string): { messages: V2vMessage[]; plain: string[] } {
  const messages: V2vMessage[] = []
  const plain: string[] = []
  for (const raw of log.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("{")) {
      try {
        const m = JSON.parse(line)
        if (typeof m?.message === "string") { messages.push({ type: String(m.type || ""), message: m.message }); continue }
      } catch { /* a truncated line: kept as plain text */ }
    }
    plain.push(line)
  }
  return { messages, plain }
}

const clip = (s: string) => {
  const one = s.replaceAll(/\s+/g, " ").trim()
  return one.length > 300 ? `${one.slice(0, 297)}...` : one
}

/**
 * Decide from virt-v2v-in-place's exit code and machine-readable log whether
 * the conversion may be committed. An exit code 0 is not enough: virt-v2v
 * finishes "successfully" on a Windows it has no drivers for (2.6.0 does not
 * know Server 2025, measured), leaving a guest set up for emulated devices.
 * Only an explicit "has virtio drivers installed" counts as converted.
 */
export function parseConversionOutcome(log: string, exitCode: number | null): ConversionOutcome {
  const { messages, plain } = readMessages(log)
  // "Converting Rocky Linux 9.8 (Blue Onyx) (rocky9) to run on KVM": the name,
  // without the inspector's trailing short id, unless the name is a bare
  // version ("Converting 13.7 (debian13)", a Debian cloud image on the lab),
  // where the id is what says which system it is.
  const converting = messages.map(m => /^Converting (.+?) to run on KVM/.exec(m.message)?.[1]).find(Boolean)
  const shortName = converting?.replace(/ \([\w.-]+\)$/, "")
  const os = shortName && /[a-z]/i.test(shortName) ? shortName : converting
  const warnings = messages.filter(m => m.type === "warning").map(m => clip(m.message))
  if (exitCode === null || Number.isNaN(exitCode)) {
    return { ok: false, os, warnings, reason: "virt-v2v-in-place did not finish" }
  }
  if (exitCode === 90) {
    return { ok: false, os, warnings, reason: "the conversion overlay could not be created on the node" }
  }
  if (exitCode !== 0) {
    const all = [...messages.map(m => m.message), ...plain].join("\n")
    // A Windows powered off hard (no VMware Tools at cutover), hibernated or
    // shut down with Fast Startup: libguestfs refuses to write to a dirty NTFS,
    // and repairing it behind the guest's back is not ours to do (the cold
    // pipeline stopped running ntfsfix for the same reason).
    if (/mounted read-only|not cleanly unmounted|Windows Hibernation|Fast Restart/i.test(all)) {
      return { ok: false, os, warnings, reason: "the Windows filesystem was not shut down cleanly (powered off hard because VMware Tools were not running, or hibernation / Fast Startup), and virt-v2v does not write to it. Install VMware Tools on the source so the cutover shuts Windows down cleanly" }
    }
    const err = [...messages].reverse().find(m => m.type === "error")?.message
      ?? [...plain].reverse().find(l => /error/i.test(l))
      ?? plain.at(-1)
    return { ok: false, os, warnings, reason: clip((err || `virt-v2v-in-place exited with code ${exitCode}`).replace(/^virt-v2v-in-place: error:\s*/, "")) }
  }
  const text = messages.map(m => m.message).join("\n")
  if (/This guest has virtio drivers installed/i.test(text)) return { ok: true, os, warnings }
  const noDrivers = messages.find(m => /no virtio drivers available/i.test(m.message))?.message
  if (noDrivers || /does not have virtio drivers installed/i.test(text)) {
    return { ok: false, os, warnings, reason: clip(noDrivers ?? "virt-v2v could not install the VirtIO drivers in this guest") }
  }
  return { ok: false, os, warnings, reason: "virt-v2v-in-place did not report VirtIO drivers in the guest" }
}

/** One shell line that prints a token per prerequisite present on the node. */
export function conversionPreflightCommand(): string {
  return [
    "test -x /usr/bin/virt-v2v-in-place && echo v2v-in-place",
    `test -f ${VIRTIO_WIN_ISO} && echo virtio-win`,
    "( test -f /usr/share/virt-tools/rhsrvany.exe || test -f /usr/share/virt-tools/pvvxsvc.exe ) && echo srvany",
    "true",
  ].join("; ")
}

/** What is missing on the node to convert this guest, from the preflight output. */
export function missingConversionPrereqs(output: string, isWindows: boolean): string[] {
  const has = new Set(output.split(/\s+/).filter(Boolean))
  const missing: string[] = []
  if (!has.has("v2v-in-place")) missing.push("virt-v2v-in-place (package virt-v2v)")
  if (isWindows && !has.has("virtio-win")) missing.push(`the VirtIO drivers for Windows (${VIRTIO_WIN_ISO})`)
  if (isWindows && !has.has("srvany")) missing.push("rhsrvany.exe (Windows first-boot helper)")
  return missing
}

export interface GuestConversionInput {
  jobId: string
  connectionId: string
  nodeIp: SshTarget
  /** Source VM name, for the domain XML. */
  name: string
  firmware: "efi" | "bios"
  isWindows: boolean
  memoryMB?: number
  /** Block device of every copied volume, in target disk order. */
  devices: string[]
  log: (msg: string, level?: LogLevel) => Promise<void>
  isCancelled: () => boolean
  pollMs?: number
  timeoutMs?: number
}

/** `seconds` and `os` when converted; `reason` when not. */
export interface GuestConversionResult { converted: boolean; os?: string; seconds?: number; reason?: string }

/**
 * Run the conversion and commit it only when it succeeded. Never throws, except
 * "Migration cancelled": any other failure leaves the volumes untouched and is
 * returned as a reason, so the cutover goes on with the compatible hardware.
 */
export async function convertGuestAtCutover(a: GuestConversionInput): Promise<GuestConversionResult> {
  const ssh = (cmd: string, timeoutMs?: number) => executeSSH(a.connectionId, a.nodeIp, cmd, timeoutMs)
  const dir = conversionDir(a.jobId)
  const pollMs = a.pollMs ?? POLL_MS
  const timeoutMs = a.timeoutMs ?? GUEST_CONVERSION_TIMEOUT_MS
  let pid = ""
  const cleanup = async () => {
    // The script's children first (virt-v2v-in-place, which tears its
    // appliance down on SIGTERM), then the script itself.
    if (pid) await ssh(`pkill -TERM -P ${pid}; kill ${pid}`).catch(() => {})
    await ssh(`rm -rf ${shellEscape(dir)}`).catch(() => {})
  }

  try {
    const pf = await ssh(conversionPreflightCommand())
    const missing = missingConversionPrereqs(pf.output || "", a.isWindows)
    if (missing.length > 0) return { converted: false, reason: `missing on the node: ${missing.join(", ")}` }
    if (a.devices.length === 0 || a.devices.some(d => !d)) return { converted: false, reason: "a target volume has no block device on the node" }

    const overlays = a.devices.map((_, i) => `${dir}/disk${i}.qcow2`)
    const xml = buildConversionXml({ name: a.name, firmware: a.firmware, overlays, memoryMB: a.memoryMB })
    const script = buildConversionScript(a.jobId, a.devices, xml)
    const launch = await ssh(`nohup bash -c ${shellEscape(script)} > /dev/null 2>&1 & echo $!`)
    pid = /^\d+$/.test((launch.output || "").trim()) ? (launch.output || "").trim() : ""
    if (!launch.success || !pid) return { converted: false, reason: `virt-v2v-in-place could not be started: ${launch.error || "no process id"}` }
    await a.log(`Guest conversion: virt-v2v-in-place running on ${a.devices.length} disk(s) through overlays; the target volumes are only written if it succeeds`)

    const t0 = Date.now()
    let exitCode: number | null = null
    while (exitCode === null) {
      if (a.isCancelled()) throw new Error("Migration cancelled")
      if (Date.now() - t0 > timeoutMs) {
        return { converted: false, reason: `virt-v2v-in-place did not finish within ${Math.round(timeoutMs / 60000)} min` }
      }
      await new Promise(r => setTimeout(r, pollMs))
      const r = await ssh(`cat ${shellEscape(`${dir}/exit`)} 2>/dev/null || echo RUNNING`).catch(() => null)
      const out = (r?.output || "").trim()
      if (/^\d+$/.test(out)) exitCode = Number(out)
    }
    pid = ""
    const seconds = Math.round((Date.now() - t0) / 1000)
    const logOut = await ssh(`cat ${shellEscape(`${dir}/v2v.log`)} 2>/dev/null || true`).catch(() => null)
    const outcome = parseConversionOutcome(logOut?.output || "", exitCode)
    // The warning that became the reason is said once, in the caller's line.
    for (const w of outcome.warnings.filter(w => w !== outcome.reason)) await a.log(`Guest conversion: virt-v2v warning: ${w}`, "warn")
    if (!outcome.ok) return { converted: false, reason: outcome.reason || "conversion failed" }

    // Commit disk by disk. A commit only copies the overlay's clusters into
    // the volume; a failure here is the one case that may leave a volume half
    // written, so it is reported as such rather than as a clean fallback.
    for (let i = 0; i < overlays.length; i++) {
      const c = await ssh(`qemu-img commit -q ${shellEscape(overlays[i])}`, COMMIT_TIMEOUT_MS)
      if (!c.success) {
        return { converted: false, reason: `the converted disk ${i + 1} could not be written back (${c.error || c.output || "qemu-img commit failed"})${i > 0 ? `; disks 1 to ${i} were already converted` : ""}` }
      }
    }
    return { converted: true, os: outcome.os, seconds }
  } catch (e: any) {
    if (String(e?.message || e) === "Migration cancelled") throw e
    return { converted: false, reason: String(e?.message || e) }
  } finally {
    await cleanup()
  }
}

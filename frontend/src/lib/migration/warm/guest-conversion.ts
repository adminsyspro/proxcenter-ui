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
 * VirtIO drivers is committed into the volumes (`qemu-img commit`). Anything
 * else drops the overlays: the volumes are exactly the verified copy, and the
 * guest boots on the compatible hardware as before. This holds on every block
 * storage warm supports, thick LVM included, which has no snapshot.
 *
 * Trim (discussion #1169): virt-v2v always ends with an fstrim of the guest
 * filesystems, and every trimmed block lands in the overlay as a zero cluster.
 * The commit then rewrites the whole free space of the disk as zeros: 11 GiB
 * for 21 MiB of real changes on a 12 GiB disk, 113 s at 100 MB/s, past the old
 * 15 min ceiling on a large disk. Neither `discard="ignore"` in the domain XML
 * nor `qemu-nbd --discard=ignore` alone keeps them out (lab, virt-v2v 2.6.0).
 * What does: virt-v2v converts a /dev/nbdN chained as qemu-nbd (discard
 * ignored) behind nbdkit's nozero filter, so trims reach nothing and the
 * overlay holds only the conversion (0 zero clusters, 26 MiB, commit 0.04 s).
 * The blocks the guest trimmed keep their old content, which its filesystem
 * holds as free. Warm already needs nbdkit and nbd-client on the node; without
 * them the overlays are converted directly, as before.
 *
 * The commit runs detached and is polled like the conversion: the guest must
 * never start while a commit still writes into its volumes.
 *
 * Measured on the lab (virt-v2v 2.6.0, PVE 9): 41 to 64 s per guest.
 */

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { SshTarget } from "@/lib/ssh/node-endpoint-core"
import { NBD_RELEASE_HOLDERS_FN, nbdReleaseHoldersCall } from "../nbd-holders"
import type { GuestStaticIpv4 } from "@/lib/vmware/soap"
import { buildNetworkPinScript, describeNetworkPinReport, NETWORK_PIN_REPORT, NETWORK_PIN_SCRIPT, parseNetworkPinReport, type GuestNic } from "./guest-network"
import { unsupportedWindowsReason, VIRT_V2V_MARKERS, windowsUnsupportedByVirtV2v, type VirtV2vSupport } from "./virt-v2v-windows"
import { virtV2vBackportProbe } from "../virt-v2v-backport"
import { windowsOnlineDisksCommand, windowsOnlineDisksFailed, windowsOnlineDisksScheduled } from "../windows-online-disks"

export { GUEST_CONVERSION_ESTIMATE_SEC } from "./guest-conversion-estimate"

/** Ceiling for one conversion; a guest that takes longer is left unconverted. */
export const GUEST_CONVERSION_TIMEOUT_MS = 30 * 60 * 1000

const POLL_MS = 3000
/** A commit takes a fraction of a second once the trims are kept out: polled tighter, it adds no downtime. */
const COMMIT_POLL_MS = 1000
/** How often a commit still running is reported in the job log. */
const COMMIT_NOTICE_MS = 5 * 60 * 1000
const VIRTIO_WIN_ISO = "/usr/share/virtio-win/virtio-win.iso"

export type LogLevel = "info" | "success" | "warn" | "error"

/** Working directory of a job's conversion on the node (overlays, domain XML, log). */
export function conversionDir(jobId: string): string {
  return `/tmp/proxcenter-convert-${jobId.replaceAll(/[^A-Za-z0-9_-]/g, "")}`
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

/** Placeholder of disk i's /dev/nbdN in the domain XML, filled in by the script once attached. */
export const nbdPlaceholder = (i: number) => `@NBD${i}@`

/**
 * Minimal libvirt domain for `virt-v2v-in-place -i libvirtxml`: the firmware
 * (virt-v2v checks it against what it finds in the guest) and one disk per
 * overlay, in target order so disk 0 stays the boot disk. With `viaNbd`, each
 * disk is the block device the script attaches the overlay to (see
 * buildConversionScript), named by its placeholder.
 */
export function buildConversionXml(a: { name: string; firmware: "efi" | "bios"; overlays: string[]; memoryMB?: number; viaNbd?: boolean }): string {
  const os = a.firmware === "efi" ? '<os firmware="efi">' : "<os>"
  const disks = a.overlays.map((path, i) => {
    const dev = `sd${String.fromCodePoint(97 + (i % 26))}`
    const source = a.viaNbd
      ? `<disk type="block" device="disk"><driver name="qemu" type="raw"/><source dev="${nbdPlaceholder(i)}"/>`
      : `<disk type="file" device="disk"><driver name="qemu" type="qcow2"/><source file="${xmlEscape(path)}"/>`
    return `${source}<target dev="${dev}" bus="scsi"/></disk>`
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
 * Shell functions to expose overlay i as a /dev/nbdN that drops trims, and to
 * take every such chain of a conversion down again. The chain is qemu-nbd
 * (`--discard=ignore`) on a socket, nbdkit's nozero filter in front of it (it
 * hides write-zeroes, the other road a trim takes from the appliance to the
 * overlay), and the kernel client on the first free device, picked the way
 * buildNbdConnectCmd does: a device another job grabs first only makes our
 * attach fail. What is up is recorded in `$D` (pid files, `nbd<i>.dev`), so the
 * same teardown serves the script's own end and a cancellation, and only ever
 * detaches a device this conversion attached. POSIX sh: the cleanup runs it
 * over SSH outside the script.
 */
export function nbdChainFunctions(): string {
  return [
    NBD_RELEASE_HOLDERS_FN,
    "nbd_chain_up() {",
    '  qemu-nbd --fork --persistent --discard=ignore -f qcow2 -k "$D/q$1.sock" --pid-file="$D/q$1.pid" "$D/disk$1.qcow2" >> "$D/nbd.log" 2>&1 || return 1',
    '  nbdkit -P "$D/k$1.pid" -U "$D/k$1.sock" --filter=nozero nbd socket="$D/q$1.sock" zeromode=none >> "$D/nbd.log" 2>&1 || return 1',
    "  modprobe nbd max_part=0 2>/dev/null",
    "  for j in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do",
    "    [ -s /sys/block/nbd$j/pid ] && continue",
    '    if nbd-client -unix "$D/k$1.sock" /dev/nbd$j >> "$D/nbd.log" 2>&1; then echo /dev/nbd$j > "$D/nbd$1.dev"; return 0; fi',
    "  done",
    "  return 1",
    "}",
    "nbd_chain_down() {",
    '  for f in "$D"/nbd*.dev; do',
    '    [ -s "$f" ] || continue',
    '    n=$(cat "$f")',
    `    ${nbdReleaseHoldersCall('"$n"')}`,
    '    nbd-client -d "$n" >/dev/null 2>&1',
    '    rm -f "$f"',
    "  done",
    // nbdkit before qemu-nbd, and wait for each: qemu-nbd flushes the overlay
    // as it exits, and the commit must read it complete.
    '  for p in "$D"/k*.pid "$D"/q*.pid; do',
    '    [ -s "$p" ] || continue',
    '    pid=$(cat "$p"); kill "$pid" 2>/dev/null',
    '    t=0; while kill -0 "$pid" 2>/dev/null && [ $t -lt 100 ]; do sleep 0.1; t=$((t + 1)); done',
    '    rm -f "$p"',
    "  done",
    "}",
  ].join("\n")
}

/**
 * The detached script: overlays on the target devices, then the conversion,
 * then the exit code in `<dir>/exit` (90 when an overlay could not be made).
 *
 * With `viaNbd`, virt-v2v converts the overlays through nbdChainFunctions'
 * chains so its trims stay out of them. A chain that cannot be set up falls
 * back to the direct overlays (`guest-file.xml`) and leaves `<dir>/nbd-fallback`
 * for the caller to say so. The chains are down before the exit code is
 * written: once it is there, the overlays are complete.
 * `--block-driver virtio-scsi` makes Windows boot-start vioscsi rather than
 * viostor, matching the scsi0 slot the guest gets. `< /dev/null` turns any
 * interactive question (`--root ask` on a multi-root guest) into a failure.
 *
 * With `netpin` (a Linux guest), guestfish first runs it inside the guest to
 * pin the interface names (see guest-network.ts) and copies its report to
 * `<dir>/netpin.txt`. It writes to the same overlays, so it reaches the
 * volumes only with the conversion, and it runs BEFORE virt-v2v: the SELinux
 * relabel virt-v2v sets up (`/.autorelabel` on PVE, whose appliance has no
 * setfiles) then covers the new files too. Its failure never stops the run.
 *
 * `extraArgs` go to virt-v2v-in-place as they are (see windowsStaticIpArgs).
 *
 * With `onlineDisks` (a Windows with data disks), a conversion that exited 0
 * is followed by virt-customize on the boot overlay, which schedules the
 * first-boot script that brings the data disks online (windows-online-disks.ts),
 * its exit code in `<dir>/online-disks.exit`. It runs on the overlays once the
 * NBD chains are down, and before the exit code that says the run is over.
 */
export function buildConversionScript(jobId: string, devices: string[], xml: string, netpin?: string, extraArgs: string[] = [], fileXml?: string, onlineDisks = false): string {
  const dir = conversionDir(jobId)
  const q = shellEscape
  const b64 = (text: string) => q(Buffer.from(text).toString("base64"))
  const lines = [
    `D=${q(dir)}`,
    'rm -rf "$D"; mkdir -p "$D" || exit 1',
    `echo ${b64(xml)} | base64 -d > "$D/guest.xml"`,
    ...devices.map((dev, i) => `qemu-img create -q -f qcow2 -b ${q(dev)} -F raw "$D/disk${i}.qcow2" > "$D/overlay.log" 2>&1 || { echo 90 > "$D/exit"; exit 0; }`),
    ...(netpin ? [
      `echo ${q(Buffer.from(netpin).toString("base64"))} | base64 -d > "$D/netpin.sh"`,
      `LIBGUESTFS_BACKEND=direct guestfish --format=qcow2 ${devices.map((_, i) => `-a "$D/disk${i}.qcow2"`).join(" ")} -i`
        + ` upload "$D/netpin.sh" ${NETWORK_PIN_SCRIPT} : sh "/bin/sh ${NETWORK_PIN_SCRIPT}"`
        + ` : download ${NETWORK_PIN_REPORT} "$D/netpin.txt" : rm-f ${NETWORK_PIN_SCRIPT} : rm-f ${NETWORK_PIN_REPORT}`
        + ` < /dev/null > "$D/netpin.log" 2>&1`,
    ] : []),
    ...(fileXml ? [
      `echo ${b64(fileXml)} | base64 -d > "$D/guest-file.xml"`,
      nbdChainFunctions(),
      `if ${devices.map((_, i) => `nbd_chain_up ${i}`).join(" && ")}; then`,
      ...devices.map((_, i) => `  sed -i "s|${nbdPlaceholder(i)}|$(cat "$D/nbd${i}.dev")|" "$D/guest.xml"`),
      "else",
      '  nbd_chain_down; mv "$D/guest-file.xml" "$D/guest.xml"; echo fallback > "$D/nbd-fallback"',
      "fi",
    ] : []),
    `LIBGUESTFS_BACKEND=direct stdbuf -oL virt-v2v-in-place -i libvirtxml "$D/guest.xml" --block-driver virtio-scsi${extraArgs.map(x => ` ${q(x)}`).join("")} --machine-readable < /dev/null > "$D/v2v.log" 2>&1`,
    "RC=$?",
    ...(fileXml ? ["nbd_chain_down"] : []),
    ...(onlineDisks ? [
      'if [ "$RC" = 0 ]; then',
      windowsOnlineDisksCommand({ disk: '"$D/disk0.qcow2"', disks: devices.length, localPath: '"$D/online-disks.ps1"', logPath: '"$D/online-disks.log"', format: "qcow2" }),
      '  echo $? > "$D/online-disks.exit"',
      "fi",
    ] : []),
    'echo $RC > "$D/exit"',
  ]
  return lines.join("\n")
}

/**
 * The detached commit of every overlay into its volume, in disk order. It
 * writes `ok` to `<dir>/commit-exit` when all are in, or `failed <i>` (0-based)
 * at the first that is not, with qemu-img's message in `<dir>/commit.log`.
 */
export function buildCommitScript(jobId: string, count: number): string {
  const lines = [`D=${shellEscape(conversionDir(jobId))}`, ': > "$D/commit.log"']
  for (let i = 0; i < count; i++) {
    lines.push(`qemu-img commit -q "$D/disk${i}.qcow2" >> "$D/commit.log" 2>&1 || { echo 'failed ${i}' > "$D/commit-exit"; exit 0; }`)
  }
  lines.push('echo ok > "$D/commit-exit"')
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
 * Only an explicit "has virtio drivers installed" counts as converted. With
 * what the node probe found out about its virt-v2v, a release it does not
 * know is named as the cause (#1173): its "no virtio drivers available"
 * reads as if the ISO lacked them.
 */
export function parseConversionOutcome(log: string, exitCode: number | null, virtV2v?: VirtV2vSupport): ConversionOutcome {
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
    // A Windows powered off hard (no guest tools at cutover), hibernated or
    // shut down with Fast Startup: libguestfs refuses to write to a dirty NTFS,
    // and repairing it behind the guest's back is not ours to do (the cold
    // pipeline stopped running ntfsfix for the same reason).
    if (/mounted read-only|not cleanly unmounted|Windows Hibernation|Fast Restart/i.test(all)) {
      return { ok: false, os, warnings, reason: "the Windows filesystem was not shut down cleanly (powered off hard because the guest tools were not running, or hibernation / Fast Startup), and virt-v2v does not write to it. Install the guest tools on the source (VMware Tools, XCP-ng Windows PV tools) so the cutover shuts Windows down cleanly" }
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
    const unsupported = windowsUnsupportedByVirtV2v(noDrivers, virtV2v)
    if (unsupported) return { ok: false, os, warnings, reason: unsupportedWindowsReason(unsupported, virtV2v?.version) }
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
    "command -v qemu-nbd >/dev/null && command -v nbd-client >/dev/null && nbdkit --filter=nozero nbd --version >/dev/null 2>&1 && echo nbd-chain",
    virtV2vSupportCommand(),
    "true",
  ].join("; ")
}

/** Shell lines printing what virtV2vSupportOf reads; only reads, for the warm and the cold preflight alike. */
export function virtV2vSupportCommand(): string {
  return [
    `v=$(virt-v2v-in-place --version 2>/dev/null | awk '{print $2; exit}'); test -n "$v" && echo "v2v-version=$v"`,
    // The Windows releases its compiled driver table knows (virt-v2v-windows.ts)
    `test -f /usr/bin/virt-v2v-in-place && echo v2v-probed && for m in ${VIRT_V2V_MARKERS.join(" ")}; do grep -aqF "$m" /usr/bin/virt-v2v-in-place && echo "v2v-knows=$m"; done`,
    virtV2vBackportProbe(),
  ].join("; ")
}

/** Whether the node can keep virt-v2v's trims out of the overlays (nbdChainFunctions), from the preflight output. */
export function canKeepTrimsOut(output: string): boolean {
  return output.split(/\s+/).includes("nbd-chain")
}

/** What the preflight output says of the node's virt-v2v: its version, the Windows releases it knows when the binary was probed, and whether ProxCenter's backport applies. */
export function virtV2vSupportOf(output: string): VirtV2vSupport {
  const tokens = output.split(/\s+/)
  const version = tokens.find(t => t.startsWith("v2v-version="))?.slice("v2v-version=".length)
  const knows = tokens.filter(t => t.startsWith("v2v-knows=")).map(t => t.slice("v2v-knows=".length))
  return { ...(version && { version }), ...(tokens.includes("v2v-probed") && { knows }), ...(tokens.includes("v2v-backport") && { backport: true }) }
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

/**
 * A Windows guest binds its IP configuration to the adapter, and on Proxmox
 * it finds a new one (VirtIO, or e1000 where the source had vmxnet3): a
 * static IP is gone. virt-v2v sets it again at first boot on the adapter
 * with the given MAC (`--mac <mac>:ip:<address>,<gateway>,<len>,<dns>...`).
 * Only the NICs the target keeps the MAC of, and one address per NIC: the
 * first manual IPv4 the guest reported.
 */
export function windowsStaticIpArgs(ips: GuestStaticIpv4[], targetMacs: string[]): string[] {
  const keep = new Set(targetMacs.map(m => m.toLowerCase()))
  return ips
    .filter(ip => keep.has(ip.mac.toLowerCase()))
    .flatMap(ip => ["--mac", `${ip.mac.toLowerCase()}:ip:${[ip.address, ip.gateway ?? "", String(ip.prefixLength), ...ip.dns].join(",")}`])
}

/** Job log lines for the static IPs a converted Windows gets back at first boot. */
export function describeWindowsStaticIps(ips: GuestStaticIpv4[], targetMacs: string[]): { msg: string; level: LogLevel }[] {
  const keep = new Set(targetMacs.map(m => m.toLowerCase()))
  return ips.filter(ip => keep.has(ip.mac.toLowerCase())).flatMap(ip => {
    const parts = [`${ip.address}/${ip.prefixLength}`]
    if (ip.gateway) parts.push(`gateway ${ip.gateway}`)
    if (ip.dns.length > 0) parts.push(`DNS ${ip.dns.join(" ")}`)
    const what = parts.join(", ")
    const lines: { msg: string; level: LogLevel }[] = [{ msg: `Guest network: the static IPv4 configuration of ${ip.mac} (${what}) is set again on the new adapter at the first boot`, level: "success" }]
    if (ip.extraAddresses > 0) lines.push({ msg: `Guest network: ${ip.mac} had ${ip.extraAddresses} more static IPv4 address(es); only the first one is set again, add the others after the first boot`, level: "warn" })
    return lines
  })
}

/** What the interface pinning did, read from the node once the conversion is committed. */
async function readNetworkPin(ssh: (cmd: string) => Promise<{ output?: string }>, dir: string): Promise<{ msg: string; level: LogLevel }[]> {
  const r = await ssh(`cat ${shellEscape(`${dir}/netpin.txt`)} 2>/dev/null || { echo FAILED; tail -n 3 ${shellEscape(`${dir}/netpin.log`)} 2>/dev/null; }`).catch(() => null)
  const out = r?.output || ""
  if (out.startsWith("FAILED")) {
    const why = clip(out.slice("FAILED".length)) || "no report"
    return [{ msg: `Guest network: the interface names could not be pinned (${why}); check the network settings after the first boot`, level: "warn" }]
  }
  return describeNetworkPinReport(parseNetworkPinReport(out))
}

/** Whether the data disks of a converted Windows were set to come online at first boot (buildConversionScript's `onlineDisks`). */
async function readOnlineDisks(ssh: (cmd: string) => Promise<{ output?: string }>, dir: string, dataDisks: number): Promise<{ msg: string; level: LogLevel }> {
  const exitFile = shellEscape(`${dir}/online-disks.exit`)
  const logFile = shellEscape(`${dir}/online-disks.log`)
  const r = await ssh(`cat ${exitFile} 2>/dev/null; echo; tail -n 3 ${logFile} 2>/dev/null`).catch(() => null)
  const [code = "", ...rest] = (r?.output || "").split("\n")
  if (code.trim() === "0") return { msg: windowsOnlineDisksScheduled(dataDisks), level: "success" }
  return { msg: windowsOnlineDisksFailed(clip(rest.join(" ").trim()) || (code.trim() ? `virt-customize exited with code ${code.trim()}` : "")), level: "warn" }
}

export interface GuestConversionInput {
  jobId: string
  connectionId: string
  nodeIp: SshTarget
  /** Source VM name, for the domain XML. */
  name: string
  firmware: "efi" | "bios"
  isWindows: boolean
  /** The source's OS name ("Microsoft Windows Server 2025 (64-bit)"): a release the node's virt-v2v predates is not converted. */
  guestOs?: string
  memoryMB?: number
  /** Block device of every copied volume, in target disk order. */
  devices: string[]
  /** Target NICs with their source names: a Linux guest gets its interface names pinned (guest-network.ts). */
  nics?: GuestNic[]
  /** Static IPv4 configuration the guest reported before the cutover: a Windows guest gets it set again. */
  staticIps?: GuestStaticIpv4[]
  log: (msg: string, level?: LogLevel) => Promise<void>
  isCancelled: () => boolean
  pollMs?: number
  timeoutMs?: number
}

/**
 * `seconds` and `os` when converted; `reason` when not. `notes` holds the log
 * lines of what came with the conversion (interface pinning, static IPs, data
 * disks), for the caller to write after its own "converted" line. `volumesWritten` marks the one failure after which the
 * volumes are not the copy any more: a commit that started and did not finish.
 */
export interface GuestConversionResult {
  converted: boolean
  os?: string
  seconds?: number
  reason?: string
  volumesWritten?: boolean
  notes?: { msg: string; level: LogLevel }[]
}

/** The job log line of a conversion that is not used, for the warm pipelines. */
export function conversionNotAppliedMessage(r: GuestConversionResult): { msg: string; level: LogLevel } {
  const reason = (r.reason || "").replace(/\.+$/, "")
  if (r.volumesWritten) {
    return { msg: `Guest conversion failed while writing the converted disks back: ${reason}. A disk may be partly converted: the guest is started on the hardware it boots on without new drivers (SATA disks and e1000 NICs for Windows, a SATA boot disk for UEFI guests), check that it boots`, level: "error" }
  }
  return { msg: `Guest conversion not applied: ${reason}. The copied disks are unchanged and the guest keeps the hardware it boots on without new drivers (SATA disks and e1000 NICs for Windows, a SATA boot disk for UEFI guests)`, level: "warn" }
}

/**
 * Run the conversion and commit it only when it succeeded. Never throws, except
 * "Migration cancelled": any other failure is returned as a reason, so the
 * cutover goes on with the compatible hardware. Until a commit starts, the
 * volumes are untouched; a commit that fails is returned with `volumesWritten`.
 * It returns only once nothing of the conversion runs on the node any more.
 */
export async function convertGuestAtCutover(a: GuestConversionInput): Promise<GuestConversionResult> {
  const ssh = (cmd: string, timeoutMs?: number) => executeSSH(a.connectionId, a.nodeIp, cmd, timeoutMs)
  const dir = conversionDir(a.jobId)
  const q = shellEscape
  const pollMs = a.pollMs ?? POLL_MS
  const timeoutMs = a.timeoutMs ?? GUEST_CONVERSION_TIMEOUT_MS
  let pid = ""
  let viaNbd = false
  let committing = false
  const cleanup = async () => {
    // The script's children first (virt-v2v-in-place, which tears its
    // appliance down on SIGTERM, or qemu-img commit), then the script itself,
    // then the NBD chains it may have left up.
    if (pid) await ssh(`pkill -TERM -P ${pid}; kill ${pid}`).catch(() => {})
    if (viaNbd) await ssh(`D=${q(dir)}\n${nbdChainFunctions()}\nnbd_chain_down`).catch(() => {})
    await ssh(`rm -rf ${q(dir)}`).catch(() => {})
  }
  /** Start a detached script on the node and keep its pid for the cleanup. */
  const launch = async (script: string): Promise<string | null> => {
    const r = await ssh(`nohup bash -c ${q(script)} > /dev/null 2>&1 & echo $!`)
    const out = (r.output || "").trim()
    pid = r.success && /^\d+$/.test(out) ? out : ""
    return pid ? null : (r.error || "no process id")
  }
  /** One read of a file the detached script writes when it is done; null while it runs. */
  const readDone = async (file: string): Promise<string | null> => {
    const r = await ssh(`cat ${q(`${dir}/${file}`)} 2>/dev/null || echo RUNNING`).catch(() => null)
    const out = (r?.output || "").trim()
    return out && out !== "RUNNING" ? out : null
  }
  const sleep = (ms = pollMs) => new Promise(r => setTimeout(r, ms))

  try {
    const pf = await ssh(conversionPreflightCommand())
    const missing = missingConversionPrereqs(pf.output || "", a.isWindows)
    if (missing.length > 0) return { converted: false, reason: `missing on the node: ${missing.join(", ")}` }
    if (a.devices.length === 0 || a.devices.some(d => !d)) return { converted: false, reason: "a target volume has no block device on the node" }
    // A Windows the node's virt-v2v does not know gets no driver: not worth the
    // minute of downtime the run costs (#1173).
    const virtV2v = virtV2vSupportOf(pf.output || "")
    const unsupported = a.isWindows ? windowsUnsupportedByVirtV2v(a.guestOs, virtV2v) : null
    if (unsupported) return { converted: false, reason: unsupportedWindowsReason(unsupported, virtV2v.version) }
    viaNbd = canKeepTrimsOut(pf.output || "")

    const overlays = a.devices.map((_, i) => `${dir}/disk${i}.qcow2`)
    const domain = { name: a.name, firmware: a.firmware, overlays, memoryMB: a.memoryMB }
    const xml = buildConversionXml({ ...domain, viaNbd })
    const netpin = !a.isWindows && a.nics && a.nics.length > 0 ? buildNetworkPinScript(a.nics) : undefined
    const targetMacs = (a.nics ?? []).map(n => n.mac)
    const winIps = a.isWindows ? a.staticIps ?? [] : []
    // Windows Server keeps the data disks offline on their new controller (#1173 lab).
    const onlineDisks = a.isWindows && a.devices.length > 1
    const script = buildConversionScript(a.jobId, a.devices, xml, netpin, windowsStaticIpArgs(winIps, targetMacs), viaNbd ? buildConversionXml(domain) : undefined, onlineDisks)
    const launchError = await launch(script)
    if (launchError) return { converted: false, reason: `virt-v2v-in-place could not be started: ${launchError}` }
    await a.log(`Guest conversion: virt-v2v-in-place running on ${a.devices.length} disk(s) through overlays; the target volumes are only written if it succeeds`)

    const t0 = Date.now()
    let exitCode: number | null = null
    while (exitCode === null) {
      if (a.isCancelled()) throw new Error("Migration cancelled")
      if (Date.now() - t0 > timeoutMs) {
        return { converted: false, reason: `virt-v2v-in-place did not finish within ${Math.round(timeoutMs / 60000)} min` }
      }
      await sleep()
      const out = await readDone("exit")
      if (out && /^\d+$/.test(out)) exitCode = Number(out)
    }
    pid = ""
    const seconds = Math.round((Date.now() - t0) / 1000)
    if (viaNbd && await readDone("nbd-fallback") !== null) {
      await a.log("Guest conversion: the overlays could not be attached through NBD, so virt-v2v trims the free space into them and writing them back may take as long as rewriting that free space", "warn")
    }
    const logOut = await ssh(`cat ${q(`${dir}/v2v.log`)} 2>/dev/null || true`).catch(() => null)
    const outcome = parseConversionOutcome(logOut?.output || "", exitCode, virtV2v)
    // The warning that became the reason is said once, in the caller's line.
    for (const w of outcome.warnings.filter(w => w !== outcome.reason)) await a.log(`Guest conversion: virt-v2v warning: ${w}`, "warn")
    if (!outcome.ok) return { converted: false, reason: outcome.reason || "conversion failed" }

    // The commit only copies the overlays' clusters into the volumes, but it is
    // the one step that writes them: it runs detached, and the guest does not
    // start before it ended, however long it takes (a cancellation stops it,
    // the volumes are then dropped with the job).
    const commitError = await launch(buildCommitScript(a.jobId, overlays.length))
    if (commitError) return { converted: false, reason: `the converted disks could not be written back: ${commitError}` }
    committing = true
    const c0 = Date.now()
    let notified = c0
    let commit = await readDone("commit-exit")
    while (commit === null) {
      if (a.isCancelled()) throw new Error("Migration cancelled")
      await sleep(Math.min(pollMs, COMMIT_POLL_MS))
      commit = await readDone("commit-exit")
      if (commit === null && Date.now() - notified >= COMMIT_NOTICE_MS) {
        notified = Date.now()
        await a.log(`Guest conversion: still writing the converted disks back (${Math.round((notified - c0) / 60000)} min); the guest starts once it is done`)
      }
    }
    pid = ""
    const failed = /^failed (\d+)$/.exec(commit)
    if (commit !== "ok") {
      const i = failed ? Number(failed[1]) : 0
      const detail = await ssh(`tail -n 3 ${q(`${dir}/commit.log`)} 2>/dev/null || true`).catch(() => null)
      const why = clip(detail?.output || "") || "qemu-img commit failed"
      return { converted: false, volumesWritten: true, reason: `the converted disk ${i + 1} could not be written back (${why})${i > 0 ? `; disks 1 to ${i} were already converted` : ""}` }
    }
    const notes = netpin ? await readNetworkPin(ssh, dir) : describeWindowsStaticIps(winIps, targetMacs)
    if (onlineDisks) notes.push(await readOnlineDisks(ssh, dir, a.devices.length - 1))
    return { converted: true, os: outcome.os, seconds, ...(notes.length > 0 && { notes }) }
  } catch (e: any) {
    if (String(e?.message || e) === "Migration cancelled") throw e
    return { converted: false, reason: String(e?.message || e), ...(committing && { volumesWritten: true }) }
  } finally {
    await cleanup()
  }
}

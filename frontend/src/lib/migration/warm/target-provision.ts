import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import type { PveVmCreateParams } from "../configMapper"
import { allocateAndMapBlockVolume, nextFreeDiskName, type AllocatedVolume } from "../pvesm-alloc"
import { waitForPveTask } from "../pve-tasks"
import { parseDdProgress } from "./dd-progress"
import { updateJob, updateJobLive, appendLog } from "./job-control"
import { scaleWarmProgress, APPLY_TIMEOUT_MS, APPLY_INACTIVITY_MS, PROGRESS_LOG_INTERVAL_MS } from "./apply"
import { ZERO_RATE_MIB, zeroSliceBytes, describeZeroRateLimit } from "./zero-rate"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"

// Parallel ranges for the streamed zero fallback. One dd is queue depth 1: the
// #606 field run sustained only 359 MiB/s on an FC array that reaches 1.9 GB/s
// with concurrency, i.e. 2 h 30 min to zero 3.1 TiB. FC/iSCSI arrays scale with
// outstanding I/O, so a handful of concurrent streams recovers most of it.
export const ZERO_PARALLEL_CHUNKS = 4

export interface ThickZeroOptions {
  /** Parallel dd streams per slice on the streamed fallback (default ZERO_PARALLEL_CHUNKS). */
  chunks?: number
  /** Average write rate the zeroing may not exceed, in MB/s; 0 or absent = unlimited (roadmap#45). */
  rateLimitMBps?: number
}

/** Marker lines the script prints so the caller can name the zeroing mode in the job log. */
export const ZERO_MODE_OFFLOAD_MARKER = "zero-mode: offload"
export const ZERO_MODE_STREAM_MARKER = "zero-mode: stream"

/**
 * Build the node-side command that zeroes a freshly-allocated *thick* block
 * device before the CBT copy. Unwritten regions on a thick LV are not
 * guaranteed to read as zero, and the CBT pass only writes the allocated/changed
 * map, so any gap left un-zeroed would surface a previous tenant's bytes (a
 * correctness AND information-leak bug). We prefer `blkdiscard -z` (offloaded
 * write-zeroes where the array supports it) and fall back to streaming zeros.
 * When the array refuses the offload, the script says so with a parseable
 * `blkdiscard-refused: <reason>` line, so the slow path never runs without an
 * explanation (#606), and it names the path it took with `zero-mode: offload`
 * or `zero-mode: stream` (roadmap#45).
 *
 * The device is walked in SLICES (`blkdiscard -z -o <off> -l <len>`, or the
 * same range split into `chunks` bounded dd streams on the fallback), never in
 * one call, for two reasons (roadmap#45):
 *   - progress: a whole-device `blkdiscard -z` emits nothing, so the job log
 *     read "zeroed 0.0 of N GB" for the whole phase; after every slice the
 *     script prints one line in dd's summary format (`<bytes> bytes copied,
 *     <s> s`), which parseDdProgress consumes unchanged, so the caller drives
 *     the progress bar, shows the real average rate and keeps the SSH stream
 *     within the same inactivity guard as the copy;
 *   - pacing: a write-zeroes offload ran at 1.6 GB/s for 25 minutes on a LUN
 *     shared with production VMs (multipath checks 62 s, pvestatd 352 s). With
 *     `rateLimitMBps` set, the script sleeps after a slice until the bytes done
 *     so far divided by the elapsed time are back under the cap, and the slice
 *     shrinks to about a quarter second of the allowed rate so the array sees
 *     short bursts. Unlimited keeps the historical behaviour, in 1 GiB slices.
 *
 * The fallback streams `head -c <bytes> /dev/zero | dd …` rather than the earlier
 * `dd if=/dev/zero of=DEV` (no count): a bare unbounded dd fills the device and
 * then issues one write *past* end-of-device, which returns ENOSPC and makes dd
 * exit 1 (this is what broke #445's disk 1 after a full 45-min zero). Every
 * stream is bounded to its exact range inside the slice, so that failure cannot
 * come back. `iflag=fullblock` reassembles 4 MiB blocks across the pipe so
 * O_DIRECT accepts every write; a sub-4 MiB final block is still logical-block
 * aligned because a device size is always a sector multiple. A slice is a
 * multiple of 4 MiB, the last one takes the remainder. On a range failure the
 * dd error text (kept in temp files) is replayed to stdout so the caller
 * surfaces the real cause. The whole-device size is read once so the caller's
 * own byte accounting stays authoritative.
 */
export function buildThickZeroScript(dev: string, opts: ThickZeroOptions | number = {}): string {
  const o: ThickZeroOptions = typeof opts === "number" ? { chunks: opts } : opts
  const d = shellEscape(dev)
  const n = Math.max(1, Math.floor(o.chunks ?? ZERO_PARALLEL_CHUNKS))
  const cap = Math.max(0, Math.floor(o.rateLimitMBps ?? 0)) * ZERO_RATE_MIB
  const slice = zeroSliceBytes(cap)
  const lines = [
    // Fail closed: without a size the loop below would not run and the script
    // would exit 0 on a target it never zeroed, exposing stale data.
    `sz=$(blockdev --getsize64 ${d}) || { echo "zero-error: cannot read the size of ${d}"; exit 1; }`,
    `case "$sz" in ''|*[!0-9]*) echo "zero-error: unexpected size '$sz' for ${d}"; exit 1;; esac`,
    `[ "$sz" -gt 0 ] || { echo "zero-error: ${d} reports a size of 0"; exit 1; }`,
    `t=$(mktemp -d)`,
    `trap 'rm -rf "$t"' EXIT`,
    `start=$(($(date +%s%N) / 1000000))`,
    `cap=${cap}`,
    `slice=${slice}`,
    `off=0`,
    `mode=offload`,
    // Elapsed milliseconds; the progress line carries them as "<s>.<ms> s".
    `ms() { echo $(($(date +%s%N) / 1000000 - start)); }`,
    `report() { e=$(ms); echo "$off bytes copied, $((e / 1000)).$(printf %03d $((e % 1000))) s"; }`,
    // Token bucket over the whole run: with `off` bytes done, we may not be
    // earlier than off/cap seconds in; sleep the difference. Integer math in
    // milliseconds keeps every term far below 2^63 for any realistic device.
    `pace() { [ "$cap" -gt 0 ] || return 0; e=$(ms); due=$((off * 1000 / cap)); [ "$due" -gt "$e" ] || return 0; w=$((due - e)); sleep "$((w / 1000)).$(printf %03d $((w % 1000)))"; }`,
    `while [ "$off" -lt "$sz" ]; do`,
    `  len=$((sz - off)); [ "$len" -le "$slice" ] || len=$slice`,
    `  if [ "$mode" = offload ]; then`,
    `    if out=$(blkdiscard -z -o "$off" -l "$len" ${d} 2>&1); then`,
    `      [ "$off" -ne 0 ] || echo "${ZERO_MODE_OFFLOAD_MARKER}"`,
    `    else`,
    // Whatever the array refused (first slice or mid-way), the SAME slice is
    // redone by streaming, and every following one too.
    `      echo "blkdiscard-refused: $out"; echo "${ZERO_MODE_STREAM_MARKER}"; mode=stream; continue`,
    `    fi`,
    `  else`,
    `    per=$((len / ${n} / 4194304 * 4194304))`,
  ]
  for (let i = 0; i < n; i++) {
    const bound = i === n - 1 ? `"$((len - ${i} * per))"` : `"$per"`
    lines.push(`    head -c ${bound} /dev/zero | dd of=${d} bs=4M iflag=fullblock oflag=seek_bytes,direct conv=notrunc status=none seek=$((off + ${i} * per)) 2>"$t/z${i}" & p${i}=$!`)
  }
  lines.push(`    fail=0`)
  for (let i = 0; i < n; i++) lines.push(`    wait $p${i} || fail=1`)
  lines.push(
    `    if [ "$fail" -ne 0 ]; then cat "$t"/z*; exit 1; fi`,
    `  fi`,
    `  off=$((off + len)); pace; report`,
    `done`,
    `[ "$off" -eq "$sz" ] || { echo "zero-error: stopped at $off of $sz bytes"; exit 1; }`,
  )
  return lines.join("\n")
}

/** "4 min 05 s" style duration for the job log. */
export function formatZeroElapsed(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`
}

/**
 * Mark every allocated volume as holding a completed, snapshot-consistent copy of
 * its source disk. Called only once a copy pass has finished for ALL disks (the
 * CBT full pass, or the checksum fallback after its last disk): each pass applies
 * a VMware-snapshot-consistent image, so a completed pass leaves the target
 * bootable, and `volumesToFree` then keeps it out of failure cleanup (#612). A run
 * that fails mid pass never reaches this, so a half-written target is still freed.
 */
export function markVolumesCopied(allocatedVolumes: AllocatedVolume[]): void {
  for (const v of allocatedVolumes) v.copied = true
}

/**
 * Create the target VM shell (no data disks yet), wait for the create task and
 * return the shell's config as PVE sees it, so the caller can number its data
 * volumes after whatever the shell already owns.
 */
export async function createTargetVmShell(pveConn: any, node: string, pveParams: PveVmCreateParams): Promise<Record<string, any>> {
  const createBody = new URLSearchParams({
    vmid: String(pveParams.vmid), name: pveParams.name, ostype: pveParams.ostype,
    cores: String(pveParams.cores), sockets: String(pveParams.sockets), memory: String(pveParams.memory),
    cpu: pveParams.cpu, scsihw: pveParams.scsihw, bios: pveParams.bios, machine: pveParams.machine,
    agent: pveParams.agent, serial0: "socket",
  })
  // Every source NIC, net0 to netN (#317).
  for (const [key, value] of Object.entries(pveParams.nets)) createBody.set(key, value)
  if (pveParams.efidisk0) createBody.set("efidisk0", pveParams.efidisk0)
  // Empty TPM 2.0 state for a source with a vTPM (roadmap#1); it takes a
  // vm-<vmid>-disk-N number too, which the data disks are numbered after.
  if (pveParams.tpmstate0) createBody.set("tpmstate0", pveParams.tpmstate0)
  const created = await pveFetch<any>(pveConn, `/nodes/${encodeURIComponent(node)}/qemu`, { method: "POST", body: createBody })
  if (created) await waitForPveTask(pveConn, node, String(created))

  // The VM shell may already own a disk: an OVMF/UEFI guest gets an efidisk0
  // (vm-<vmid>-disk-0) created with `qm create`. Data disks must therefore start
  // after the highest existing disk number, or `pvesm alloc` collides on the name.
  return pveFetch<Record<string, any>>(pveConn, `/nodes/${encodeURIComponent(node)}/qemu/${pveParams.vmid}/config`)
}

/**
 * One source disk to provision a raw block target for, on its own storage: the
 * operator can send each disk of a VMware source to a different block storage
 * (#317, lot 2), so the storage and its PVE type travel with the disk.
 */
export interface ProvisionDisk {
  key: number
  capacityBytes: number
  /** Target storage of this disk. */
  storage: string
  /** PVE type of that storage (lvm, lvmthin, zfspool, rbd, ...), which decides the zeroing. */
  storageType: string
}

/**
 * Storage types whose fresh volumes already read as zero. Plain (thick) LVM is
 * not one of them, see the zeroing note in provisionBlockTargets.
 */
const PRE_ZEROED_STORAGE_TYPES = ["lvmthin", "zfspool", "zfs", "rbd"]

/** Whether a fresh volume on this disk's storage needs the mandatory thick zeroing. */
function needsThickZero(disk: ProvisionDisk): boolean {
  return !PRE_ZEROED_STORAGE_TYPES.includes(disk.storageType)
}

// ── preparing_disks: allocate a raw block volume per disk, zero the thick ones ──
// A dedicated phase, not enabling_cbt: on thick LVM the mandatory pre-zero
// below can run for hours, and the badge must say what the job is doing (#606).
// Progress covers 0→10 of the locked scale, weighted by the bytes that are
// actually zeroed: only the disks on a thick storage count, a disk on a thin
// pool costs one discard and no progress.
export async function provisionBlockTargets(a: {
  jobId: string; connectionId: string; nodeIp: SshTarget; targetVmid: number
  shellConf: Record<string, any>; disks: ProvisionDisk[]; allocatedVolumes: AllocatedVolume[]
  /** Cap on the thick zeroing write rate in MB/s; 0 or absent = unlimited (roadmap#45). */
  zeroRateLimitMBps?: number
}): Promise<Map<number, string>> {
  const { jobId, connectionId, nodeIp, targetVmid, shellConf, disks, allocatedVolumes } = a
  const rateLimitMBps = a.zeroRateLimitMBps && a.zeroRateLimitMBps > 0 ? Math.floor(a.zeroRateLimitMBps) : 0
  const sliceMiB = zeroSliceBytes(rateLimitMBps * ZERO_RATE_MIB) / ZERO_RATE_MIB
  const targetDev = new Map<number, string>()
  await updateJob(jobId, "preparing_disks")
  const zeroTotalBytes = disks.filter(needsThickZero).reduce((s, d) => s + d.capacityBytes, 0)
  let zeroedBytes = 0
  let lastZeroPct = 0
  for (let i = 0; i < disks.length; i++) {
    const disk = disks[i]
    const sizeKB = Math.ceil(disk.capacityBytes / 1024)
    // Numbering walks forward as each disk registers itself in allocatedVolumes,
    // across every storage of the run: vm-<vmid>-disk-N is unique per VM.
    const volName = nextFreeDiskName(shellConf, allocatedVolumes, targetVmid)
    // See allocateAndMapBlockVolume for the raw format and why the volume is
    // registered for cleanup before the allocation runs (#587).
    const vol = await allocateAndMapBlockVolume({
      connectionId, nodeIp,
      targetStorage: disk.storage, targetVmid, volName, sizeKB,
      allocatedVolumes,
    })
    const dev = vol.devicePath
    targetDev.set(disk.key, dev)
    // Unwritten regions MUST read as zero: the CBT pass writes only the
    // allocated/changed map, so any block it skips is left as-is on the target.
    // Thin pools (LVM-thin / ZFS / Ceph RBD) hand back pre-zeroed volumes, so a
    // cheap discard suffices. Plain (thick) LVM does NOT: a bare DISCARD only
    // *permits* zero reads, it does not guarantee them, so a freshly-alloc'd
    // thick LV can surface a previous tenant's bytes (a correctness AND
    // information-leak bug). Write-zero those (slow but mandatory); fail hard if
    // it doesn't succeed rather than copy onto stale data. Decided per disk:
    // the disks of one run may sit on storages of different types.
    if (!needsThickZero(disk)) {
      await executeSSH(connectionId, nodeIp, `blkdiscard ${shellEscape(dev)} 2>/dev/null || true`)
    } else {
      // #606: this step used to be hours of total silence (no start line, no
      // output, status stuck on enabling_cbt) and operators cancelled healthy
      // runs. Announce it, stream the script's per-slice progress through the
      // same inactivity guard as the copy, name the mode the script took
      // (offload or streamed zeros, roadmap#45) and surface why the blkdiscard
      // offload was refused when the streamed slow path runs.
      const capGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `Disk ${i + 1}: zeroing thick target ${dev} (${capGB} GB): mandatory on thick storage and can take a long time. Rate limit ${describeZeroRateLimit(rateLimitMBps)}, ${sliceMiB} MiB slices; mode and progress follow`)
      let markerBuf = ""              // first KBs of output; carries the mode and refusal markers
      let modeLogged = false
      let refusalLogged = false
      // An object, not a `let`: TypeScript does not see assignments made from the
      // onData closure, and would narrow a plain variable to its initial value.
      const zeroMode: { value: "offload" | "stream" | "unknown" } = { value: "unknown" }
      let lastFlush = 0
      const zeroStart = Date.now()
      const onData = (chunk: string): void => {
        if ((!modeLogged || !refusalLogged) && markerBuf.length < 16384) {
          markerBuf += chunk
          if (!modeLogged && markerBuf.includes(ZERO_MODE_OFFLOAD_MARKER)) {
            modeLogged = true
            zeroMode.value = "offload"
            void appendLog(jobId, `Disk ${i + 1}: the array accepted the write-zeroes offload (blkdiscard -z); zeroing in ${sliceMiB} MiB slices`).catch(() => {})
          }
          const m = /blkdiscard-refused: ([^\r\n]*)/.exec(markerBuf)
          if (!refusalLogged && m) {
            refusalLogged = true
            modeLogged = true
            zeroMode.value = "stream"
            void appendLog(jobId, `Disk ${i + 1}: the array refused the write-zeroes offload (${m[1].trim() || "no reason given"}); streaming zeros from /dev/zero in ${ZERO_PARALLEL_CHUNKS} parallel ranges per ${sliceMiB} MiB slice instead`, "warn").catch(() => {})
          }
        }
        const p = parseDdProgress(chunk)
        if (!p) return
        const now = Date.now()
        if (now - lastFlush < PROGRESS_LOG_INTERVAL_MS) return
        lastFlush = now
        const diskBytes = Math.min(p.bytes, disk.capacityBytes)
        const pct = Math.max(lastZeroPct, scaleWarmProgress(0, 10, zeroedBytes + diskBytes, zeroTotalBytes))
        lastZeroPct = pct
        // Progress first, then the log line: appendLog stamps each entry with
        // the job's current progress, which is why the lines used to read 0 (#502).
        void (async () => {
          await updateJobLive(jobId, "preparing_disks", { progress: pct, transferSpeed: `Zeroing: ${(p.bytesPerSec / ZERO_RATE_MIB).toFixed(0)} MB/s` })
          await appendLog(jobId, `Disk ${i + 1}: zeroed ${(diskBytes / 1073741824).toFixed(1)} of ${capGB} GB (${(p.bytesPerSec / ZERO_RATE_MIB).toFixed(0)} MB/s average)`)
        })().catch(() => {})
      }
      const z = await executeSSH(connectionId, nodeIp, buildThickZeroScript(dev, { rateLimitMBps }), APPLY_TIMEOUT_MS, { inactivityMs: APPLY_INACTIVITY_MS, onData })
      // Surface z.output first: the script replays the range dd errors to
      // stdout, so the real cause (e.g. "No space left on device", an array
      // I/O error) lands in output while error is just "Exit code N" on the
      // ssh2 path.
      if (!z.success) throw new Error(`Failed to zero thick target ${dev} before warm copy (unwritten regions would expose stale data): ${z.output || z.error}`)
      // Every slice that was zeroed prints its mode first: a run that ends
      // without one never zeroed anything, whatever its exit status.
      if (zeroMode.value === "unknown") throw new Error(`Failed to zero thick target ${dev} before warm copy (unwritten regions would expose stale data): the zeroing script reported no zeroed slice. ${z.output || ""}`.trim())
      const elapsedSec = Math.max(0.001, (Date.now() - zeroStart) / 1000)
      const avgMBps = disk.capacityBytes / elapsedSec / ZERO_RATE_MIB
      const modeLabel = zeroMode.value === "stream" ? "streamed zeros" : "write-zeroes offload"
      await appendLog(jobId, `Disk ${i + 1}: zeroed thick target ${dev} in ${formatZeroElapsed(elapsedSec)} (${modeLabel}, ${avgMBps.toFixed(0)} MB/s average, limit ${describeZeroRateLimit(rateLimitMBps)})`, "success")
      zeroedBytes += disk.capacityBytes
    }
    await appendLog(jobId, `Disk ${i + 1}: target ${vol.volumeId} → ${dev} (${(disk.capacityBytes / 1073741824).toFixed(1)} GB)`)
  }
  return targetDev
}

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import type { PveVmCreateParams } from "../configMapper"
import { allocateAndMapBlockVolume, nextFreeDiskName, type AllocatedVolume } from "../pvesm-alloc"
import { waitForPveTask } from "../pve-tasks"
import { parseDdProgress } from "./dd-progress"
import { updateJob, updateJobLive, appendLog } from "./job-control"
import { scaleWarmProgress, APPLY_TIMEOUT_MS, APPLY_INACTIVITY_MS, PROGRESS_LOG_INTERVAL_MS } from "./apply"

// Parallel ranges for the streamed zero fallback. One dd is queue depth 1: the
// #606 field run sustained only 359 MiB/s on an FC array that reaches 1.9 GB/s
// with concurrency, i.e. 2 h 30 min to zero 3.1 TiB. FC/iSCSI arrays scale with
// outstanding I/O, so a handful of concurrent streams recovers most of it.
export const ZERO_PARALLEL_CHUNKS = 4

/**
 * Build the node-side command that zeroes a freshly-allocated *thick* block
 * device before the CBT copy. Unwritten regions on a thick LV are not
 * guaranteed to read as zero, and the CBT pass only writes the allocated/changed
 * map, so any gap left un-zeroed would surface a previous tenant's bytes (a
 * correctness AND information-leak bug). We prefer `blkdiscard -z` (offloaded
 * write-zeroes where the array supports it) and fall back to streaming zeros.
 * When the array refuses the offload, the script says so with a parseable
 * `blkdiscard-refused: <reason>` line — previously that reason was only visible
 * if the whole script failed, so the slow path ran with no explanation (#606).
 *
 * The fallback streams `head -c <bytes> /dev/zero | dd …` rather than the earlier
 * `dd if=/dev/zero of=DEV` (no count): a bare unbounded dd fills the device and
 * then issues one write *past* end-of-device, which returns ENOSPC and makes dd
 * exit 1 — even though every block was already zeroed — so the thick-zero step
 * could never succeed (this is what broke #445's disk 1 after a full 45-min
 * zero). The device is split into `chunks` equal 4 MiB-aligned ranges (the last
 * takes the remainder) and each range gets its own bounded stream, run in
 * parallel and reaped with `wait` (#606). Every stream is still bounded to its
 * exact range, so the #445 ENOSPC-past-EOF failure cannot come back.
 * `iflag=fullblock` reassembles 4 MiB blocks across the pipe so O_DIRECT
 * accepts every write, including a sub-4 MiB final block (still logical-block
 * aligned because a device size is always a sector multiple).
 *
 * The step used to run `status=none` — hours of total silence on a multi-TB LV,
 * indistinguishable from a hang (#606). Now each range dd writes
 * `status=progress` to its own temp file and a background poller sums the last
 * counter of every range every 10 s into ONE line in dd's own summary format
 * (`<bytes> bytes copied, <s> s`), so parseDdProgress consumes it unchanged,
 * the caller can drive the progress bar, and the SSH stream stays alive for the
 * same inactivity guard as the copy. On a range failure the dd error text (kept
 * in the temp files) is replayed to stdout so the caller surfaces the real cause.
 */
export function buildThickZeroScript(dev: string, chunks: number = ZERO_PARALLEL_CHUNKS): string {
  const d = shellEscape(dev)
  const n = Math.max(1, Math.floor(chunks))
  const lines = [
    `sz=$(blockdev --getsize64 ${d})`,
    `t=$(mktemp -d)`,
    `start=$(date +%s)`,
    `( while :; do sleep 10; b=0; for f in "$t"/z*; do [ -s "$f" ] || continue; v=$(tr '\\r' '\\n' < "$f" | awk '/ bytes /{n=$1} END{print n+0}'); b=$((b+v)); done; echo "$b bytes copied, $(($(date +%s)-start)) s"; done ) & poller=$!`,
    `trap 'kill $poller 2>/dev/null; rm -rf "$t"' EXIT`,
    `if out=$(blkdiscard -z ${d} 2>&1); then echo "$sz bytes copied, $(($(date +%s)-start)) s"; exit 0; fi`,
    `echo "blkdiscard-refused: $out"`,
    `per=$((sz / ${n} / 4194304 * 4194304))`,
  ]
  for (let i = 0; i < n; i++) {
    const bound = i === n - 1 ? `"$((sz - ${i} * per))"` : `"$per"`
    lines.push(`head -c ${bound} /dev/zero | dd of=${d} bs=4M iflag=fullblock oflag=seek_bytes,direct conv=notrunc status=progress seek=$((${i} * per)) 2>"$t/z${i}" & p${i}=$!`)
  }
  lines.push(`fail=0`)
  for (let i = 0; i < n; i++) lines.push(`wait $p${i} || fail=1`)
  lines.push(`if [ "$fail" -ne 0 ]; then for f in "$t"/z*; do tr '\\r' '\\n' < "$f" | grep -v ' bytes \\|records '; done; exit 1; fi`)
  lines.push(`echo "$sz bytes copied, $(($(date +%s)-start)) s"`)
  return lines.join("\n")
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
    net0: pveParams.net0, agent: pveParams.agent, serial0: "socket",
  })
  if (pveParams.efidisk0) createBody.set("efidisk0", pveParams.efidisk0)
  const created = await pveFetch<any>(pveConn, `/nodes/${encodeURIComponent(node)}/qemu`, { method: "POST", body: createBody })
  if (created) await waitForPveTask(pveConn, node, String(created))

  // The VM shell may already own a disk: an OVMF/UEFI guest gets an efidisk0
  // (vm-<vmid>-disk-0) created with `qm create`. Data disks must therefore start
  // after the highest existing disk number, or `pvesm alloc` collides on the name.
  return pveFetch<Record<string, any>>(pveConn, `/nodes/${encodeURIComponent(node)}/qemu/${pveParams.vmid}/config`)
}

/** One source disk to provision a raw block target for. */
export interface ProvisionDisk { key: number; capacityBytes: number }

// ── preparing_disks: allocate a raw block volume per disk, zero the thick ones ──
// A dedicated phase, not enabling_cbt: on thick LVM the mandatory pre-zero
// below can run for hours, and the badge must say what the job is doing (#606).
// Progress covers 0→10 of the locked scale, weighted by bytes zeroed across
// all disks (they share the target storage, so it is all-thick or none).
export async function provisionBlockTargets(a: {
  jobId: string; connectionId: string; nodeIp: string
  targetStorage: string; storageType: string; targetVmid: number
  shellConf: Record<string, any>; disks: ProvisionDisk[]; allocatedVolumes: AllocatedVolume[]
}): Promise<Map<number, string>> {
  const { jobId, connectionId, nodeIp, targetStorage, storageType, targetVmid, shellConf, disks, allocatedVolumes } = a
  const targetDev = new Map<number, string>()
  await updateJob(jobId, "preparing_disks")
  const zeroTotalBytes = disks.reduce((s, d) => s + d.capacityBytes, 0)
  let zeroedBytes = 0
  let lastZeroPct = 0
  for (let i = 0; i < disks.length; i++) {
    const disk = disks[i]
    const sizeKB = Math.ceil(disk.capacityBytes / 1024)
    // Numbering walks forward as each disk registers itself in allocatedVolumes.
    const volName = nextFreeDiskName(shellConf, allocatedVolumes, targetVmid)
    // See allocateAndMapBlockVolume for the raw format and why the volume is
    // registered for cleanup before the allocation runs (#587).
    const vol = await allocateAndMapBlockVolume({
      connectionId, nodeIp,
      targetStorage, targetVmid, volName, sizeKB,
      allocatedVolumes,
    })
    const dev = vol.devicePath
    targetDev.set(disk.key, dev)
    // Unwritten regions MUST read as zero: the CBT pass writes only the
    // allocated/changed map, so any block it skips is left as-is on the target.
    // Thin pools (LVM-thin / ZFS / Ceph RBD) hand back pre-zeroed volumes, so a
    // cheap discard suffices. Plain (thick) LVM does NOT — a bare DISCARD only
    // *permits* zero reads, it does not guarantee them, so a freshly-alloc'd
    // thick LV can surface a previous tenant's bytes (a correctness AND
    // information-leak bug). Write-zero those (slow but mandatory); fail hard if
    // it doesn't succeed rather than copy onto stale data.
    const preZeroed = ["lvmthin", "zfspool", "zfs", "rbd"].includes(storageType)
    if (preZeroed) {
      await executeSSH(connectionId, nodeIp, `blkdiscard ${shellEscape(dev)} 2>/dev/null || true`)
    } else {
      // #606: this step used to be hours of total silence (no start line, no
      // output, status stuck on enabling_cbt) — operators cancelled healthy
      // runs. Announce it, stream the script's aggregated dd progress through
      // the same inactivity guard as the copy, and surface why the blkdiscard
      // offload was refused when the streamed slow path runs.
      const capGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `Disk ${i}: zeroing thick target ${dev} (${capGB} GB) — mandatory on thick storage and can take a long time; live throughput follows`)
      let headBuf = ""              // first KBs of output; carries the refusal marker
      let refusalLogged = false
      let lastFlush = 0
      const onData = (chunk: string): void => {
        if (!refusalLogged && headBuf.length < 8192) {
          headBuf += chunk
          const m = /blkdiscard-refused: ([^\r\n]*)/.exec(headBuf)
          if (m) {
            refusalLogged = true
            void appendLog(jobId, `Disk ${i}: array refused the blkdiscard write-zeroes offload (${m[1].trim() || "no reason given"}) — streaming zeros in ${ZERO_PARALLEL_CHUNKS} parallel ranges instead`, "warn").catch(() => {})
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
        // Progress first, then the log line — appendLog stamps each entry with
        // the job's current progress, which is why the lines used to read 0 (#502).
        void (async () => {
          await updateJobLive(jobId, "preparing_disks", { progress: pct, transferSpeed: `Zeroing: ${(p.bytesPerSec / 1048576).toFixed(0)} MB/s` })
          await appendLog(jobId, `Disk ${i}: zeroed ${(diskBytes / 1073741824).toFixed(1)} of ${capGB} GB`)
        })().catch(() => {})
      }
      const z = await executeSSH(connectionId, nodeIp, buildThickZeroScript(dev), APPLY_TIMEOUT_MS, { inactivityMs: APPLY_INACTIVITY_MS, onData })
      // Surface z.output first: the script replays the range dd errors to
      // stdout, so the real cause (e.g. "No space left on device", an array
      // I/O error) lands in output while error is just "Exit code N" on the
      // ssh2 path.
      if (!z.success) throw new Error(`Failed to zero thick target ${dev} before warm copy (unwritten regions would expose stale data): ${z.output || z.error}`)
      await appendLog(jobId, `Disk ${i}: zeroed thick target ${dev}`)
    }
    zeroedBytes += disk.capacityBytes
    await appendLog(jobId, `Disk ${i}: target ${vol.volumeId} → ${dev} (${(disk.capacityBytes / 1073741824).toFixed(1)} GB)`)
  }
  return targetDev
}

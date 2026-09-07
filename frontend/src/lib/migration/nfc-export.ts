/**
 * NFC export phase of the cold vCenter migration (#807).
 *
 * vCenter hands out one HttpNfcLease per export and streams each disk as a
 * stream-optimized VMDK that the ESXi host compresses on the fly. Two facts
 * shape this module:
 *
 * - The ceiling is per stream, not per link: one NFC stream sits around 20 to
 *   30 MB/s whatever the network offers. Disks therefore download in parallel,
 *   bounded by `concurrency` (the dialog's "Parallel disk downloads" slider),
 *   each with its own fresh lease. Per-disk leases also sidestep a vSAN quirk where the second device
 *   URL of a shared lease starts answering empty chunked 200s once the first
 *   disk has been consumed.
 * - The bytes landing on the node are compressed, so they say nothing about
 *   how far into the disk the export is. Progress comes from the position
 *   inside the disk read from the stream itself (./nfc-stream-probe), and the
 *   job counters are kept in those logical bytes so the task bar's ETA is
 *   right on thin disks. The wire figures stay in the log lines.
 *
 * The downloads run as detached curl processes on the Proxmox node, polled
 * over SSH every 5 s: exit status, stream position, stall detection and a
 * keep-alive to vCenter (a lease dies after about 5 min of silence).
 */
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import {
  soapExportVm,
  soapExportSnapshot,
  soapWaitForNfcLease,
  soapNfcLeaseProgress,
  soapNfcLeaseComplete,
  soapNfcLeaseAbort,
} from "@/lib/vmware/soap"
import type { SoapSession, NfcLeaseDeviceUrl, EsxiVmConfig } from "@/lib/vmware/soap"
import { NfcProgressTracker, runWithConcurrency } from "./nfc-progress"
import { NFC_STREAM_PROBE_SCRIPT, probeCommand, parseNfcStreamProbe, type NfcStreamProbe } from "./nfc-stream-probe"

export type NfcLogLevel = "info" | "success" | "warn" | "error"

/** What the export needs from the pipeline that owns the job row. */
export interface NfcJobIo {
  appendLog: (jobId: string, msg: string, level?: NfcLogLevel) => Promise<void>
  updateJob: (jobId: string, status: "transferring", extra: Record<string, unknown>) => Promise<void>
  isCancelled: (jobId: string) => boolean
}

export interface NfcExportParams {
  jobId: string
  targetConnectionId: string
  sourceVmId: string
  nodeIp: string
  session: SoapSession
  /** Staging directory on the node; disks land there as disk-<n>.vmdk. */
  outputDir: string
  /** Source VM inspection, used for the disk capacities before the stream header confirms them. */
  sourceVmwareConfig: EsxiVmConfig | null
  /**
   * Snapshot MOR when exporting a running VM: ExportSnapshot is the only path
   * that works while the base VMDKs are locked by the running instance. Null
   * exports the powered-off VM itself with ExportVm.
   */
  snapshotMor: string | null
  /** Slice of the job's 0..100 progress that the transfer occupies. */
  band: { offset: number; scale: number }
  /** Disks downloading at once, the job's slider value already resolved and clamped. */
  concurrency: number
}

const GB = 1073741824
const gb = (n: number) => (n / GB).toFixed(1)
/** Wire figures: an empty thin disk streams down to a few tens of KB, which "0.0 GB" would hide. */
const wire = (n: number) => (n < GB / 20 ? `${(n / 1048576).toFixed(1)} MB` : `${gb(n)} GB`)
const POLL_MS = 5000
const MAX_STALL_POLLS = 60 // 60 * 5 s = 5 min without growth = stalled
const KEEPALIVE_MS = 30_000
const MIN_STREAM_BYTES = 65536
export const NFC_PROBE_SCRIPT_NAME = "nfc-probe.pl"

/**
 * Download every disk of the VM to `outputDir` and return the local paths in
 * disk order. On any failure every file is removed and the error rethrown; the
 * caller owns the files after a success.
 */
export async function runVcenterNfcExport(p: NfcExportParams, io: NfcJobIo): Promise<string[]> {
  const { jobId, session, outputDir, band } = p
  const ssh = (cmd: string) => executeSSH(p.targetConnectionId, p.nodeIp, cmd)

  await io.appendLog(jobId, "Opening NFC export lease via vCenter (HttpNfcLease)...", "info")
  await ssh(`mkdir -p ${shellEscape(outputDir)}`)

  const openLease = () => p.snapshotMor
    ? soapExportSnapshot(session, p.snapshotMor)
    : soapExportVm(session, p.sourceVmId)

  // A first lease only counts the disk URLs the VM exposes; every download
  // then opens its own (see the module comment).
  await io.appendLog(jobId, `Initiating NFC export lease via vCenter ${p.snapshotMor ? "ExportSnapshot" : "ExportVm"}...`)
  const probeLease = await openLease()
  let diskCount: number
  try {
    await io.appendLog(jobId, `NFC lease ${probeLease} created, waiting for ready state...`)
    const probeDevices = await soapWaitForNfcLease(session, probeLease)
    diskCount = probeDevices.filter(d => d.disk).length
    if (diskCount === 0) {
      throw new Error("NFC lease returned no disk device URLs (VM has no disks?)")
    }
    await io.appendLog(jobId, `NFC lease ready: ${diskCount} disk URL(s) to download`, "success")
  } catch (err) {
    await soapNfcLeaseAbort(session, probeLease, (err as Error)?.message || "ProxCenter probe error").catch(() => {})
    throw err
  }
  await soapNfcLeaseComplete(session, probeLease).catch(() => {})

  // The stream probe runs on the node; without it progress falls back to bytes on the wire.
  const probeScript = `${outputDir}/${NFC_PROBE_SCRIPT_NAME}`
  let probeScriptPath: string | null = probeScript
  const scriptWrite = await ssh(`printf '%s' ${shellEscape(NFC_STREAM_PROBE_SCRIPT)} > ${shellEscape(probeScript)}`)
  if (!scriptWrite.success) {
    probeScriptPath = null
    await io.appendLog(jobId, `Could not write the stream probe to ${probeScript}; progress will be estimated from bytes on the wire`, "warn")
  }

  const capacities = Array.from({ length: diskCount }, (_, i) => p.sourceVmwareConfig?.disks[i]?.capacityBytes ?? 0)
  const tracker = new NfcProgressTracker(capacities, band)
  const limit = Math.max(1, Math.min(p.concurrency, diskCount))
  await io.appendLog(jobId, `Downloading ${diskCount} disk(s), up to ${limit} at a time`, "info")
  await io.updateJob(jobId, "transferring", {
    progress: band.offset,
    bytesTransferred: BigInt(0),
    totalBytes: BigInt(tracker.summary().totalBytes),
    transferSpeed: null,
  })

  const localPath = (i: number) => `${outputDir}/disk-${i}.vmdk`
  try {
    const paths = await runWithConcurrency(diskCount, limit, async (i, abort) => {
      if (io.isCancelled(jobId)) throw new Error("Migration cancelled")
      const tag = `[NFC disk ${i + 1}/${diskCount}]`
      await io.appendLog(jobId, `${tag} Opening fresh NFC lease...`, "info")
      const leaseMor = await openLease()
      let leaseFinalised = false
      try {
        const diskDevices = (await soapWaitForNfcLease(session, leaseMor)).filter(d => d.disk)
        const dev = diskDevices[i]
        if (!dev) {
          throw new Error(`NFC lease returned ${diskDevices.length} disk URL(s) but disk index ${i} is missing`)
        }
        await io.appendLog(
          jobId,
          `${tag} Fresh lease ${leaseMor} ready, ${diskDevices.length} device URL(s) available, targeting index ${i}`,
          "info",
        )
        if (dev.fileSize === 0 && capacities[i] > 0) {
          await io.appendLog(
            jobId,
            `${tag} NFC lease reported fileSize=0 (typical for thin vSAN); using the vCenter capacity of ${gb(capacities[i])} GB until the stream header confirms the size`,
            "info",
          )
        }
        await downloadDiskViaNfc({
          jobId,
          targetConnectionId: p.targetConnectionId,
          nodeIp: p.nodeIp,
          session,
          leaseMor,
          device: dev,
          localPath: localPath(i),
          diskIndex: i,
          totalDisks: diskCount,
          capacityHint: capacities[i],
          probeScriptPath,
          tracker,
          abort,
          io,
        })
        // Anything unexpected on lease completion is swallowed by the SOAP
        // helper: the disk is on the node, that is what matters.
        await soapNfcLeaseComplete(session, leaseMor)
        leaseFinalised = true
        return localPath(i)
      } catch (err) {
        if (!leaseFinalised) {
          await soapNfcLeaseAbort(session, leaseMor, (err as Error)?.message || "ProxCenter migration error").catch(() => {})
        }
        throw err
      }
    })

    const total = tracker.summary().totalBytes
    await io.updateJob(jobId, "transferring", {
      progress: band.offset + band.scale,
      bytesTransferred: BigInt(total),
      transferSpeed: null,
    })
    await io.appendLog(jobId, `All ${diskCount} disk(s) downloaded, NFC leases completed`, "success")
    return paths
  } catch (err) {
    // Completed disks and whatever the aborted downloads left behind.
    const files = Array.from({ length: diskCount }, (_, i) => shellEscape(localPath(i))).join(" ")
    await ssh(`rm -f ${files}`).catch(() => {})
    throw err
  } finally {
    await ssh(`rm -f ${shellEscape(probeScript)}`).catch(() => {})
  }
}

interface DiskDownload {
  jobId: string
  targetConnectionId: string
  nodeIp: string
  session: SoapSession
  leaseMor: string
  device: NfcLeaseDeviceUrl
  localPath: string
  diskIndex: number
  totalDisks: number
  /** Capacity from the source VM inspection, 0 when unknown; the stream header overrides it. */
  capacityHint: number
  probeScriptPath: string | null
  tracker: NfcProgressTracker
  abort: { aborted: boolean }
  io: NfcJobIo
}

interface Observation {
  /** Bytes on the node's filesystem. */
  size: number
  /** Bytes of the disk streamed so far, null when the probe is unavailable. */
  position: number | null
  eos: boolean
}

/**
 * Download one disk through its NFC device URL with a detached curl on the
 * node, and feed the shared tracker until curl exits.
 *
 * Auth: NFC URLs accept the SOAP session cookie. It goes into a curl config
 * file (mode 600) rather than the command line so the session id never shows
 * in process listings. Self-signed vCenter certificates need `insecure`.
 */
async function downloadDiskViaNfc(d: DiskDownload): Promise<void> {
  const { jobId, io, tracker, diskIndex, session, device, localPath } = d
  const tag = `[NFC disk ${diskIndex + 1}/${d.totalDisks}]`
  const ssh = (cmd: string) => executeSSH(d.targetConnectionId, d.nodeIp, cmd)

  let capacity = d.capacityHint > 0 ? d.capacityHint : Math.max(0, device.fileSize)
  const diskLabel = () => (capacity > 0 ? `${gb(capacity)} GB` : "unknown size")
  await io.appendLog(jobId, `${tag} Downloading ${device.targetId || device.key} (${diskLabel()})...`)

  // vSphere's Set-Cookie usually returns the session id WITH surrounding double
  // quotes (vmware_soap_session="abc"). Unescaped in a curl config file, the
  // inner quotes stop curl's parser at the first one and drop the session id,
  // which lands as a 401 from vCenter.
  const cookieEsc = (session.cookie || "").replaceAll("\\", "\\\\").replaceAll('"', '\\"')

  const ctrlPrefix = `${localPath}.ctrl`
  const pidFile = `${ctrlPrefix}.pid`
  const exitFile = `${ctrlPrefix}.exit`
  const errFile = `${ctrlPrefix}.err`
  const statsFile = `${ctrlPrefix}.stats`
  const curlCfg = `${ctrlPrefix}.curlcfg`
  const ctrlFiles = [pidFile, exitFile, errFile, statsFile].map(shellEscape).join(" ")

  // write-out captures the HTTP code, final body size and timing so a
  // silently truncated stream (HTTP 200 with a tiny chunked body) can be
  // diagnosed from the job log.
  const cfgContent = [
    `header = "Cookie: ${cookieEsc}"`,
    `output = "${localPath}"`,
    `url = "${device.url}"`,
    `write-out = "http_code=%{http_code}\\nresponse_code=%{response_code}\\nsize_download=%{size_download}\\ntime_total=%{time_total}\\ncontent_type=%{content_type}\\nnum_connects=%{num_connects}\\nspeed_download=%{speed_download}\\n"`,
    "silent",
    "show-error",
    "fail",
    session.insecureTLS ? "insecure" : "",
  ].filter(Boolean).join("\n")

  const writeCfg = await ssh(`printf '%s' ${shellEscape(cfgContent)} > ${shellEscape(curlCfg)} && chmod 600 ${shellEscape(curlCfg)}`)
  if (!writeCfg.success) {
    throw new Error(`Failed to write NFC curl config: ${writeCfg.error}`)
  }

  const launchCmd =
    `nohup bash -c ` +
    `"curl -K ${shellEscape(curlCfg)} >${shellEscape(statsFile)} 2>${shellEscape(errFile)}; ` +
    `echo \\$? > ${shellEscape(exitFile)}; ` +
    `rm -f ${shellEscape(curlCfg)}" ` +
    `> /dev/null 2>&1 & echo $!`
  const launch = await ssh(launchCmd)
  if (!launch.success || !launch.output?.trim()) {
    await ssh(`rm -f ${shellEscape(curlCfg)}`).catch(() => {})
    throw new Error(`Failed to start NFC download: ${launch.error}`)
  }
  const pid = launch.output.trim()
  await ssh(`echo ${pid} > ${shellEscape(pidFile)}`)

  // The pid nohup echoed is the `bash -c` wrapper's. Killing it alone leaves
  // curl streaming as an orphan: the lease stays open on vCenter and the
  // unlinked file keeps growing until the export ends. Kill curl (the
  // wrapper's child) first, then the wrapper.
  const killAndClean = () =>
    ssh(`pkill -TERM -P ${pid} 2>/dev/null; kill ${pid} 2>/dev/null; rm -f ${shellEscape(curlCfg)} ${shellEscape(localPath)} ${ctrlFiles}`).catch(() => {})

  let probeUsable = d.probeScriptPath !== null
  let probe: NfcStreamProbe | null = null
  const observe = async (): Promise<Observation> => {
    if (probeUsable) {
      const res = await ssh(probeCommand(d.probeScriptPath!, localPath, probe?.pos ?? 0, probe?.position ?? 0))
      const parsed = parseNfcStreamProbe(res.output || "")
      if (parsed) {
        probe = parsed
        // The header is the truth for the capacity, whatever the inspection said.
        if (parsed.capacity > 0) capacity = parsed.capacity
        return { size: parsed.size, position: parsed.capacity > 0 ? parsed.position : null, eos: parsed.eos }
      }
      probeUsable = false
      await io.appendLog(
        jobId,
        `${tag} Stream probe unavailable on the node (perl missing?); progress falls back to bytes on the wire against the disk capacity`,
        "warn",
      )
    }
    const stat = await ssh(`stat -c '%s' ${shellEscape(localPath)} 2>/dev/null || echo 0`)
    return { size: Number.parseInt(stat.output?.trim() || "0", 10), position: null, eos: false }
  }

  const flush = async () => {
    const s = tracker.summary()
    await io.updateJob(jobId, "transferring", {
      progress: tracker.globalPercent(),
      bytesTransferred: BigInt(Math.round(s.bytesTransferred)),
      totalBytes: BigInt(Math.round(s.totalBytes)),
      transferSpeed: s.transferSpeed,
    })
  }

  const startedAt = Date.now()
  let lastKeepAliveAt = 0
  let lastLoggedPct = -10
  let lastSize = 0
  let stallCounter = 0

  while (true) {
    if (io.isCancelled(jobId)) {
      await killAndClean()
      throw new Error("Migration cancelled")
    }
    if (d.abort.aborted) {
      await killAndClean()
      throw new Error(`${tag} Download aborted after another disk failed`)
    }
    await new Promise(r => setTimeout(r, POLL_MS))

    const exitCheck = await ssh(`cat ${shellEscape(exitFile)} 2>/dev/null || echo RUNNING`)
    const exitOut = exitCheck.output?.trim() || "RUNNING"

    if (exitOut !== "RUNNING") {
      const exitCode = Number.parseInt(exitOut, 10)
      // Read curl's diagnostics before any cleanup: both outcomes may need them.
      const [errCapture, statsCapture] = await Promise.all([
        ssh(`tail -c 1000 ${shellEscape(errFile)} 2>/dev/null`),
        ssh(`cat ${shellEscape(statsFile)} 2>/dev/null`),
      ])
      const curlStderr = (errCapture.output || "").trim()
      const curlStats = (statsCapture.output || "").trim()

      if (exitCode !== 0) {
        await ssh(`rm -f ${shellEscape(localPath)} ${ctrlFiles}`).catch(() => {})
        throw new Error(
          `NFC disk download failed (curl exit ${exitCode}). ` +
          `URL: ${device.url}. ` +
          `Stats: ${curlStats || "(none)"}. ` +
          `Curl stderr: ${curlStderr || "(empty)"}. ` +
          `Common causes: vCenter cert mismatch (set insecureTLS on the connection), ` +
          `expired SOAP session (lease timed out), ` +
          `or vCenter NFC service unhealthy.`,
        )
      }
      if (curlStats) {
        await io.appendLog(jobId, `${tag} curl: ${curlStats.replaceAll("\n", " ")}`, "info")
      }
      const cleanupCtrl = () => ssh(`rm -f ${ctrlFiles}`).catch(() => {})

      // curl --fail catches HTTP >= 400 but not a truncated chunked body, and
      // vCenter does occasionally end a stream early. Three checks: a minimum
      // size, the KDMV sparse-stream magic, and the end-of-stream marker when
      // the probe could read the stream.
      const final = await observe()
      const got = final.size
      const diagSuffix = ` [curl: ${(curlStats || "(no stats)").replaceAll("\n", " ")}]` +
        (curlStderr ? ` [stderr: ${curlStderr.slice(0, 200)}]` : "")

      if (got < MIN_STREAM_BYTES) {
        await cleanupCtrl()
        throw new Error(
          `NFC disk download produced a suspiciously small file (${got} bytes) at ${localPath}. ` +
          `vCenter likely terminated the NFC lease prematurely; retry the migration.${diagSuffix}`,
        )
      }
      let validStream: boolean
      let magicDump = ""
      if (probeUsable && probe) {
        validStream = probe.capacity > 0 // the probe only reports a capacity behind a KDMV header
      } else {
        const magicRes = await ssh(`head -c 4 ${shellEscape(localPath)} 2>/dev/null | od -An -c | tr -d ' \\n\\t' || echo missing`)
        magicDump = (magicRes.output || "").trim()
        validStream = /K[^K]{0,10}D[^D]{0,10}M[^M]{0,10}V/.test(magicDump)
      }
      if (!validStream) {
        await cleanupCtrl()
        throw new Error(
          `NFC disk download did not produce a valid VMDK sparse stream at ${localPath} ` +
          `(expected KDMV magic${magicDump ? `, got: "${magicDump.slice(0, 40)}"` : ""}). ` +
          `vCenter likely returned an error body instead of the disk stream.${diagSuffix}`,
        )
      }
      if (probeUsable && !final.eos) {
        await io.appendLog(
          jobId,
          `${tag} Stream ended without its end-of-stream marker: the download may be truncated, ` +
          `virt-v2v will reject a malformed stream during conversion`,
          "warn",
        )
      } else if (!probeUsable && capacity > GB && got / capacity < 0.005) {
        // Without the probe the only hint left is the size ratio: a few tens
        // of KB for a large disk is either an empty data disk or a silent
        // truncation. virt-v2v tells them apart during conversion.
        await io.appendLog(
          jobId,
          `${tag} Only ${wire(got)} on the wire for a ${gb(capacity)} GB disk: either an empty data disk or a silent NFC truncation, ` +
          `virt-v2v will reject the stream if it is malformed`,
          "warn",
        )
      }

      await cleanupCtrl()
      tracker.update(diskIndex, {
        positionBytes: capacity > 0 ? capacity : final.position,
        wireBytes: got,
        capacityBytes: capacity > 0 ? capacity : undefined,
        done: true,
      })
      await flush()
      const elapsed = (Date.now() - startedAt) / 1000
      await io.appendLog(
        jobId,
        `${tag} Download complete in ${elapsed.toFixed(0)}s: ${wire(got)} on the wire for a ${diskLabel()} disk`,
        "success",
      )
      return
    }

    const obs = await observe()
    if (obs.size === lastSize) {
      stallCounter++
      if (stallCounter >= MAX_STALL_POLLS) {
        await killAndClean()
        throw new Error(
          `NFC disk download stalled: no progress for ${(MAX_STALL_POLLS * POLL_MS / 60000).toFixed(0)} min ` +
          `at ${gb(obs.size)} GB on the wire (disk ${diskLabel()})`,
        )
      }
    } else {
      stallCounter = 0
      lastSize = obs.size
    }

    tracker.update(diskIndex, {
      positionBytes: obs.position,
      wireBytes: obs.size,
      capacityBytes: capacity > 0 ? capacity : undefined,
    })
    const pct = tracker.diskPercent(diskIndex) ?? 0
    if (pct >= lastLoggedPct + 10) {
      const wireRate = tracker.summary().wireMBps
      const rate = wireRate == null ? "" : `, ${wireRate.toFixed(1)} MB/s on the wire`
      let where: string
      if (obs.position != null && capacity > 0) {
        where = `${gb(obs.position)} GB of ${gb(capacity)} GB, ${wire(obs.size)} on the wire${rate}`
      } else if (capacity > 0) {
        where = `${wire(obs.size)} on the wire for a ~${gb(capacity)} GB disk${rate}`
      } else {
        where = `${wire(obs.size)} on the wire${rate}`
      }
      await io.appendLog(jobId, `${tag} ${pct}% (${where})`)
      lastLoggedPct = pct
    }
    await flush()

    // Keep the lease alive; a failure here is not fatal, curl will surface a dead lease itself.
    if (Date.now() - lastKeepAliveAt >= KEEPALIVE_MS) {
      await soapNfcLeaseProgress(session, d.leaseMor, pct).catch(() => {})
      lastKeepAliveAt = Date.now()
    }
  }
}

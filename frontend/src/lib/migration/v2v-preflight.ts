import { executeSSH, shellEscape, type SSHResult } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIp } from "@/lib/ssh/node-ip"

export interface TempStorageOption {
  path: string
  availableBytes: number
  totalBytes: number
  filesystem: string
}

export interface PreflightResult {
  ssh: boolean
  virtV2vInstalled: boolean
  pvInstalled: boolean
  virtioWinInstalled: boolean
  /**
   * nbdkit server binary present on the target node. Required by virt-v2v's
   * `-i disk` mode (the NFC path used for vSAN VMs). Missing nbdkit causes the
   * migration to fail right after NFC download with "nbdkit is not installed".
   */
  nbdkitInstalled: boolean
  /**
   * nbdcopy binary present on the target node (from package `libnbd-bin` on
   * Debian). virt-v2v shells out to nbdcopy during the "Copying disk N/N"
   * phase; missing it fails the migration AFTER OS conversion succeeded,
   * which is the worst failure point cost-wise. We surface it upfront.
   */
  nbdcopyInstalled: boolean
  /**
   * rhsrvany.exe or pvvxsvc.exe present on the target node (from package
   * `guestfs-tools`). Required by virt-v2v to install Windows firstboot
   * scripts (QEMU Guest Agent, VirtIO drivers). Without it, Windows VM
   * conversion fails with "rhsrvany.exe is missing".
   */
  guestfsToolsInstalled: boolean
  /**
   * OVMF firmware present on the target node (package `ovmf`). virt-v2v
   * requires it at "Creating output metadata" for any UEFI guest — missing
   * it fails the migration AFTER the disk copy completes (worst failure
   * point cost-wise) with "cannot find firmware for UEFI guests".
   */
  ovmfInstalled: boolean
  diskSpaceAvailableBytes: number
  diskSpaceRequired: number
  diskSpaceSufficient: boolean
  errors: string[]
  detectedDisks?: string[]
  ntfsFixAvailable?: boolean
  virtCustomizeAvailable?: boolean
  tempStorages?: TempStorageOption[]
}

/**
 * Run preflight checks on a Proxmox target node to verify it can run virt-v2v migrations.
 *
 * Checks: SSH connectivity, virt-v2v installed, pv installed, /tmp disk space.
 */
export async function runV2vPreflight(
  targetConnectionId: string,
  targetNode: string,
  requiredDiskBytes: number,
  vmName?: string,
  sourceType?: string
): Promise<PreflightResult> {
  const errors: string[] = []
  const result: PreflightResult = {
    ssh: false,
    virtioWinInstalled: false,
    virtV2vInstalled: false,
    pvInstalled: false,
    nbdkitInstalled: false,
    nbdcopyInstalled: false,
    guestfsToolsInstalled: false,
    ovmfInstalled: false,
    diskSpaceAvailableBytes: 0,
    diskSpaceRequired: requiredDiskBytes,
    diskSpaceSufficient: false,
    errors,
  }

  // Resolve node IP
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  // 1. Check SSH connectivity
  const sshCheck = await executeSSH(targetConnectionId, nodeIp, "echo ok")
  if (!sshCheck.success) {
    errors.push(`SSH connectivity failed: ${sshCheck.error || "unknown error"}`)
    // If SSH fails, no point running the other checks
    return result
  }
  result.ssh = true

  // 2-4: Run remaining checks in parallel
  const [v2vCheck, pvCheck, dfCheck, virtioWinCheck, ntfsFixCheck, virtCustomizeCheck, nbdkitCheck, nbdcopyCheck, guestfsCheck, ovmfCheck] = await Promise.all([
    executeSSH(targetConnectionId, nodeIp, "which virt-v2v"),
    executeSSH(targetConnectionId, nodeIp, "which pv"),
    executeSSH(targetConnectionId, nodeIp, "df -B1 /tmp | tail -1 | awk '{print $4}'"),
    executeSSH(targetConnectionId, nodeIp, "test -f /usr/share/virtio-win/virtio-win.iso && echo yes || echo no"),
    executeSSH(targetConnectionId, nodeIp, "which ntfsfix && which qemu-nbd && echo yes || echo no"),
    executeSSH(targetConnectionId, nodeIp, "which virt-customize && echo yes || echo no"),
    executeSSH(targetConnectionId, nodeIp, "which nbdkit"),
    executeSSH(targetConnectionId, nodeIp, "which nbdcopy"),
    // rhsrvany.exe or pvvxsvc.exe: required by virt-v2v for Windows firstboot scripts
    executeSSH(targetConnectionId, nodeIp, "test -f /usr/share/virt-tools/rhsrvany.exe -o -f /usr/share/virt-tools/pvvxsvc.exe && echo yes || echo no"),
    // OVMF firmware: required for UEFI guests at "Creating output metadata"
    executeSSH(targetConnectionId, nodeIp, "test -f /usr/share/OVMF/OVMF_CODE_4M.fd -o -f /usr/share/OVMF/OVMF_CODE.fd && echo yes || echo no"),
  ])

  // 2. Check virt-v2v installed
  if (v2vCheck.success && v2vCheck.output?.trim()) {
    result.virtV2vInstalled = true
  } else {
    errors.push("virt-v2v is not installed on the target node")
  }

  // 3. Check pv installed
  if (pvCheck.success && pvCheck.output?.trim()) {
    result.pvInstalled = true
  } else {
    errors.push("pv (pipe viewer) is not installed on the target node")
  }

  // 3b. Check nbdkit (server) and nbdcopy (from libnbd-bin). Both are required
  // by virt-v2v's `-i disk` input mode which is how the NFC transport passes
  // downloaded VMDKs back to virt-v2v for vSAN-sourced migrations. Surfacing
  // them in preflight lets the UI show the same "Install" button that already
  // exists for virt-v2v itself — installV2vPackages() installs all four at once.
  if (nbdkitCheck.success && nbdkitCheck.output?.trim()) {
    result.nbdkitInstalled = true
  } else {
    errors.push("nbdkit is not installed on the target node (required for vSAN VM migration via virt-v2v -i disk)")
  }
  if (nbdcopyCheck.success && nbdcopyCheck.output?.trim()) {
    result.nbdcopyInstalled = true
  } else {
    errors.push("nbdcopy (package libnbd-bin) is not installed on the target node (required for virt-v2v disk copy step)")
  }

  // 3c. Check guestfs-tools (rhsrvany.exe / pvvxsvc.exe for Windows firstboot)
  if (guestfsCheck.success && guestfsCheck.output?.trim() === 'yes') {
    result.guestfsToolsInstalled = true
  } else {
    errors.push("guestfs-tools is not installed (rhsrvany.exe missing, required for Windows VM conversion)")
  }

  // 3d. Check OVMF firmware (UEFI guests fail at "Creating output metadata" without it)
  if (ovmfCheck.success && ovmfCheck.output?.trim() === 'yes') {
    result.ovmfInstalled = true
  } else {
    errors.push("ovmf is not installed (required for UEFI guest migration — fails after disk copy with 'cannot find firmware for UEFI guests')")
  }

  // 4. Check virtio-win drivers
  if (virtioWinCheck.success && virtioWinCheck.output?.trim() === 'yes') {
    result.virtioWinInstalled = true
  }

  // 4b. Check ntfsfix + qemu-nbd (for NTFS dirty flag recovery on Windows VMs)
  result.ntfsFixAvailable = ntfsFixCheck.success && ntfsFixCheck.output?.trim().endsWith('yes')

  // 4c. Check virt-customize (for guest tools injection)
  result.virtCustomizeAvailable = virtCustomizeCheck.success && virtCustomizeCheck.output?.trim().endsWith('yes')

  // 5. Check disk space on /tmp
  if (dfCheck.success && dfCheck.output?.trim()) {
    const availableBytes = parseInt(dfCheck.output.trim(), 10)
    if (!isNaN(availableBytes)) {
      result.diskSpaceAvailableBytes = availableBytes
      result.diskSpaceSufficient = availableBytes >= requiredDiskBytes
      if (!result.diskSpaceSufficient) {
        const availableGB = (availableBytes / 1_073_741_824).toFixed(1)
        const requiredGB = (requiredDiskBytes / 1_073_741_824).toFixed(1)
        errors.push(
          `Insufficient disk space on /tmp: ${availableGB} GB available, ${requiredGB} GB required`
        )
      }
    } else {
      errors.push(`Could not parse /tmp disk space: ${dfCheck.output}`)
    }
  } else {
    errors.push(`Failed to check /tmp disk space: ${dfCheck.error || "unknown error"}`)
  }

  // 5. Check cifs-utils for Hyper-V only (needed for auto-mount)
  if (sourceType === 'hyperv') {
    const cifsCheck = await executeSSH(targetConnectionId, nodeIp, "which mount.cifs")
    if (!cifsCheck.success || !cifsCheck.output?.trim()) {
      // Not an error - pipeline will install if needed
    }
  }

  // 6. Scan available storage paths for temp files
  try {
    // Get mount points with significant space (excluding tmpfs, devtmpfs, squashfs, etc.)
    const dfAllResult = await executeSSH(targetConnectionId, nodeIp,
      `df -B1 --output=target,avail,size,fstype | tail -n +2 | awk '$4 !~ /tmpfs|devtmpfs|squashfs|overlay/ && $1 !~ /^\\/mnt\\/hyperv/ && $1 != "/" && $2 > 1073741824 {print $1"|"$2"|"$3"|"$4}'`)
    if (dfAllResult.success && dfAllResult.output?.trim()) {
      const storages: TempStorageOption[] = []
      for (const line of dfAllResult.output.trim().split('\n')) {
        const [path, avail, total, fs] = line.split('|')
        if (path && avail && total) {
          storages.push({
            path: path.trim(),
            availableBytes: parseInt(avail.trim(), 10) || 0,
            totalBytes: parseInt(total.trim(), 10) || 0,
            filesystem: fs?.trim() || 'unknown',
          })
        }
      }
      // Sort by available space descending
      storages.sort((a, b) => b.availableBytes - a.availableBytes)
      if (storages.length > 0) {
        result.tempStorages = storages
      }
    }
  } catch {}

  // 7. Scan /mnt/hyperv/ for VHDX/VHD files (Hyper-V only)
  if (sourceType === 'hyperv' && vmName) {
    try {
      const scanResult = await executeSSH(targetConnectionId, nodeIp,
        `find /mnt/hyperv -iname "*${vmName.replace(/[^a-zA-Z0-9._-]/g, '*')}*" \\( -iname "*.vhdx" -o -iname "*.vhd" \\) 2>/dev/null || true`)
      const detected = (scanResult.output || '').split('\n').map(l => l.trim()).filter(l => l && l.startsWith('/'))
      if (detected.length > 0) {
        result.detectedDisks = detected
      } else {
        // Fallback: list all VHDX/VHD in /mnt/hyperv/
        const allResult = await executeSSH(targetConnectionId, nodeIp,
          `find /mnt/hyperv -iname "*.vhdx" -o -iname "*.vhd" 2>/dev/null || true`)
        const all = (allResult.output || '').split('\n').map(l => l.trim()).filter(l => l && l.startsWith('/'))
        if (all.length > 0) {
          result.detectedDisks = all
        }
      }
    } catch {}
  }

  return result
}

// rhsrvany.exe used to ship in guestfs-tools but was dropped from the Debian
// Bookworm package. virt-v2v still requires it for Windows firstboot scripts,
// so we pull it from the Fedora mingw-srvany noarch RPM (official Koji mirror,
// HTTPS). Same workaround documented at:
//   https://blog.rackspacecloud.com/blog/2025/04/07/virt-v2v_windows_vm_migration_pre-requisite/
const MINGW_SRVANY_RPM_URL =
  "https://kojipkgs.fedoraproject.org/packages/mingw-srvany/1.1/4.fc38/noarch/mingw32-srvany-1.1-4.fc38.noarch.rpm"

/**
 * Install virt-v2v and all runtime dependencies on the target Proxmox node.
 *
 * Installs via apt: virt-v2v, pv, nbdkit, libnbd-bin (nbdcopy), guestfs-tools
 * (virt-customize), ovmf (UEFI firmware), rpm2cpio + cpio (for the rhsrvany
 * extraction step). Then, if /usr/share/virt-tools/rhsrvany.exe is missing,
 * fetches the Fedora mingw-srvany RPM and extracts the Windows .exe files
 * into /usr/share/virt-tools/ — required by virt-v2v for Windows firstboot
 * script injection (QEMU Guest Agent, VirtIO drivers).
 *
 * ntfsfix + qemu-nbd (for NTFS dirty flag recovery) are installed lazily in
 * the pipeline only when a Windows NTFS error is actually hit.
 */
export async function installV2vPackages(
  targetConnectionId: string,
  targetNode: string
): Promise<SSHResult> {
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  // Single-line bash script: `set -e` gives us early-exit on any failure, so a
  // failing rhsrvany fetch surfaces as an install error instead of silently
  // leaving preflight red after the UI says "install OK". Semicolons (not &&)
  // because the if/then/fi block can't be joined with &&.
  const script =
    // pipefail so a failing rpm2cpio can't be masked by a successful cpio
    "set -eo pipefail; " +
    "apt-get update -qq; " +
    "apt-get install -y virt-v2v pv nbdkit libnbd-bin guestfs-tools ovmf rpm2cpio cpio wget; " +
    "if [ ! -f /usr/share/virt-tools/rhsrvany.exe ] && [ ! -f /usr/share/virt-tools/pvvxsvc.exe ]; then " +
    "  TMPDIR=$(mktemp -d); " +
    "  cd \"$TMPDIR\"; " +
    `  wget -nd -q -O srvany.rpm ${MINGW_SRVANY_RPM_URL}; ` +
    "  rpm2cpio srvany.rpm | cpio -idm --quiet; " +
    "  mkdir -p /usr/share/virt-tools; " +
    "  cp ./usr/i686-w64-mingw32/sys-root/mingw/bin/*.exe /usr/share/virt-tools/; " +
    "  cd /; rm -rf \"$TMPDIR\"; " +
    "fi"

  // shellEscape wraps in single quotes — critical here so the remote shell
  // doesn't expand $(mktemp -d) / $TMPDIR before bash -c receives the script.
  return executeSSH(targetConnectionId, nodeIp, `bash -c ${shellEscape(script)}`)
}

const VIRTIO_WIN_URL = "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
const VIRTIO_WIN_PATH = "/usr/share/virtio-win/virtio-win.iso"
const VIRTIO_WIN_EXIT = "/tmp/.virtio-win-download.exit"
// Approximate size of the latest stable virtio-win ISO for progress estimation
const VIRTIO_WIN_EXPECTED_BYTES = 700 * 1024 * 1024

/**
 * Start downloading the virtio-win ISO in the background on the target node.
 * Returns immediately; use checkVirtioWinProgress() to poll.
 */
export async function startVirtioWinDownload(
  targetConnectionId: string,
  targetNode: string
): Promise<SSHResult> {
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  // Remove stale exit marker + partial file, then launch curl in background
  return executeSSH(
    targetConnectionId,
    nodeIp,
    `rm -f ${VIRTIO_WIN_EXIT} ${VIRTIO_WIN_PATH} && mkdir -p /usr/share/virtio-win && ` +
    `nohup bash -c "curl -fL -o ${VIRTIO_WIN_PATH} ${VIRTIO_WIN_URL}; echo \\$? > ${VIRTIO_WIN_EXIT}" > /dev/null 2>&1 & echo $!`,
  )
}

/**
 * Check the progress of a background virtio-win download.
 * Returns { downloading, sizeBytes, expectedBytes, percent, done, error }.
 */
export async function checkVirtioWinProgress(
  targetConnectionId: string,
  targetNode: string
): Promise<{ downloading: boolean; sizeBytes: number; expectedBytes: number; percent: number; done: boolean; error?: string }> {
  const conn = await getConnectionById(targetConnectionId)
  const nodeIp = await getNodeIp(conn, targetNode)

  // Check if the exit marker exists (means curl finished)
  const exitCheck = await executeSSH(targetConnectionId, nodeIp, `cat ${VIRTIO_WIN_EXIT} 2>/dev/null || echo RUNNING`)
  const exitOut = exitCheck.output?.trim() || "RUNNING"

  // Check current file size
  const statCheck = await executeSSH(targetConnectionId, nodeIp, `stat -c '%s' ${VIRTIO_WIN_PATH} 2>/dev/null || echo 0`)
  const sizeBytes = parseInt(statCheck.output?.trim() || "0", 10) || 0
  const percent = Math.min(99, Math.round((sizeBytes / VIRTIO_WIN_EXPECTED_BYTES) * 100))

  if (exitOut === "RUNNING") {
    return { downloading: true, sizeBytes, expectedBytes: VIRTIO_WIN_EXPECTED_BYTES, percent, done: false }
  }

  const exitCode = parseInt(exitOut, 10)
  // Clean up exit marker
  await executeSSH(targetConnectionId, nodeIp, `rm -f ${VIRTIO_WIN_EXIT}`).catch(() => {})

  if (exitCode === 0 && sizeBytes > 0) {
    return { downloading: false, sizeBytes, expectedBytes: VIRTIO_WIN_EXPECTED_BYTES, percent: 100, done: true }
  }

  return { downloading: false, sizeBytes, expectedBytes: VIRTIO_WIN_EXPECTED_BYTES, percent: 0, done: true, error: `curl exit ${exitCode}` }
}

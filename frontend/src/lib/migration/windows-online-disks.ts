/**
 * Bring a converted Windows' data disks online at first boot.
 *
 * Windows Server leaves offline the disks it finds on a new controller (SAN
 * policy "Offline Shared", OfflineReason "Policy"): after a migration, every
 * data disk is offline until someone brings it online in Disk Management.
 * virt-v2v means to handle it with its own first-boot script
 * (convert_windows.ml, "Online all virtio disks"), but that script only picks
 * disks named "*VirtIO*", the name viostor gives them. Converted with
 * `--block-driver virtio-scsi`, as both pipelines do, the disks sit on vioscsi
 * and are named "QEMU QEMU HARDDISK": the script matches none and still exits
 * 0. Measured on the lab with virt-v2v 2.6.0 (warm and cold, Windows Server
 * 2025), and upstream master filters the same way.
 *
 * This script does the job for every disk offline because of that policy, and
 * only for those: a disk offline for another reason (a redundant path, a
 * collision) is left alone. `Set-Disk -Number` and no pipeline object, so it
 * also runs under PowerShell Constrained Language Mode. It goes in through
 * virt-customize's first-boot service, the one virt-v2v's scripts use, which
 * numbers it 5000-0001: after virt-v2v's driver install, but before its wait
 * for PnP (lab 22/10). So it first gives the guest's `disks` disks up to two
 * minutes to show up.
 */
export function windowsOnlineDisksPs1(disks: number): string {
  return [
    "# ProxCenter: Windows left the disks it found on the new controller offline (SAN policy).",
    "$until = (Get-Date).AddMinutes(2)",
    `while (@(Get-Disk).Count -lt ${disks} -and (Get-Date) -lt $until) { Start-Sleep -Seconds 5 }`,
    "foreach ($d in @(Get-Disk | Where-Object { $_.IsOffline -and (\"$($_.OfflineReason)\" -in @('Policy', '1')) })) {",
    "    Write-Host \"ProxCenter: disk $($d.Number) online ($($d.FriendlyName))\"",
    "    Set-Disk -Number $d.Number -IsOffline $false",
    "    Set-Disk -Number $d.Number -IsReadOnly $false",
    "}",
    "Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue",
    "",
  ].join("\r\n")
}

/**
 * Where the script lands in the guest, as virt-customize and as Windows name
 * it: the first-boot service's own directory, which only administrators can
 * write, since the script runs as SYSTEM (not C:\Windows\Temp, where any
 * user can create files).
 */
const GUEST_DIR = "/Program Files/Guestfs/Firstboot"
const GUEST_PATH = `${GUEST_DIR}/proxcenter-online-disks.ps1`
const GUEST_PATH_WIN = String.raw`C:\Program Files\Guestfs\Firstboot\proxcenter-online-disks.ps1`

/**
 * POSIX sh lines that write the script to `localPath` and have virt-customize
 * schedule it at first boot of the Windows on `disk`, a guest of `disks` disks. Both are shell words the
 * caller quotes (`"$D/online-disks.ps1"` expands on the node). `format` is the
 * image format, given when it is not raw so libguestfs does not have to guess.
 * Output and errors go to `logPath`; the exit code is virt-customize's.
 */
export function windowsOnlineDisksCommand(a: { disk: string; disks: number; localPath: string; logPath: string; format?: "qcow2" | "raw" }): string {
  const b64 = Buffer.from(windowsOnlineDisksPs1(a.disks)).toString("base64")
  const format = a.format ? ` --format ${a.format}` : ""
  return [
    `echo '${b64}' | base64 -d > ${a.localPath}`,
    "LIBGUESTFS_BACKEND=direct virt-customize --no-network"
      + `${format} -a ${a.disk}`
      + ` --mkdir '${GUEST_DIR}'`
      + ` --upload ${a.localPath}:'${GUEST_PATH}'`
      + ` --firstboot-command 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${GUEST_PATH_WIN}"'`
      + ` < /dev/null > ${a.logPath} 2>&1`,
  ].join("\n")
}

/** The job log line once the script is scheduled, for `dataDisks` disks besides the boot one. */
export function windowsOnlineDisksScheduled(dataDisks: number): string {
  const which = dataDisks === 1 ? "data disk is" : `${dataDisks} data disks are`
  return `Guest disks: Windows keeps the disks it finds on a new controller offline, so the ${which} brought online at the first boot`
}

/** The job log line when it could not be scheduled (`why`: the tool's last words), with the operator's way out. */
export function windowsOnlineDisksFailed(why: string): string {
  return `Guest disks: the data disks could not be set to come online at the first boot (${why || "no detail"}); Windows keeps the disks it finds on a new controller offline, bring them online in Disk Management`
}

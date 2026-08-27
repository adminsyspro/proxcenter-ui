/**
 * Where a Hyper-V virtual disk lands once the connection's SMB share is
 * mounted on the Proxmox node (see the CIFS mount in lib/migration/v2v-pipeline.ts).
 *
 * Hyper-V keeps each VM's disks under `<store>\<VM>\Virtual Hard Disks\`, so the
 * file is almost never at the root of the share. Mapping only the basename
 * (`/mnt/hyperv/<file>.vhdx`) forced users to point the share at that leaf
 * folder for every VM. With the share's local path (`Get-SmbShare .Path`) the
 * relative part is kept: `D:\HYPERV\vm\Virtual Hard Disks\vm.vhdx` under a
 * share on `D:\HYPERV` becomes `/mnt/hyperv/vm/Virtual Hard Disks/vm.vhdx`.
 */

export const HYPERV_MOUNT_ROOT = "/mnt/hyperv"

function normalizeWindowsPath(p: string): string {
  return p.replaceAll("/", "\\").replace(/\\+$/, "")
}

export function hypervDiskBasename(windowsPath: string): string {
  const parts = windowsPath.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) || windowsPath
}

/**
 * Mount-side path of a disk. Falls back to the basename when the share path is
 * unknown or the disk lives outside the share (the pipeline then searches the
 * mount for that file name).
 */
export function hypervDiskMountPath(windowsPath: string, shareLocalPath?: string | null): string {
  const disk = normalizeWindowsPath(windowsPath)
  const share = shareLocalPath ? normalizeWindowsPath(shareLocalPath) : ""

  if (share && disk.toLowerCase().startsWith(`${share.toLowerCase()}\\`)) {
    const relative = disk.slice(share.length + 1).split("\\").filter(Boolean).join("/")
    if (relative) return `${HYPERV_MOUNT_ROOT}/${relative}`
  }

  return `${HYPERV_MOUNT_ROOT}/${hypervDiskBasename(windowsPath)}`
}

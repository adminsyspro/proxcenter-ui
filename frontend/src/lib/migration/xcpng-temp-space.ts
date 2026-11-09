// src/lib/migration/xcpng-temp-space.ts
//
// The offline XAPI pipeline downloads each disk as a VHD into a temp directory
// on the Proxmox node, one disk at a time, then converts it and removes it. A
// directory too small for a VHD used to fail mid-download with "Lost contact
// with the Proxmox node while monitoring the download" (lab 09/11/2026,
// /var/lib/vz/tmp on a nearly full root filesystem).
//
// What a VHD export weighs is not known up front: it is the disk's allocated
// blocks, and VDI.physical_utilisation is only refreshed by an SR scan (lab:
// 137 KB reported for a 17.6 GB VHD after the snapshots of a warm run were
// coalesced). So the virtual size, the most an export can weigh, only warns
// before the copy, and a download that stops once it has written all the free
// space it found is reported as the full directory it is.

/** Headroom over the VHD payload: block allocation table, footer. */
const SLACK_BYTES = 256 * 1024 * 1024

const gb = (b: number) => `${(b / 1073741824).toFixed(1)} GB`

/** Whether the largest disk, fully allocated, would fit; a disk is mostly smaller as a VHD. */
export function xcpngTempSpaceFits(availBytes: number, disks: { sizeBytes: number }[]): boolean {
  if (disks.length === 0) return true
  return availBytes >= Math.max(...disks.map(d => d.sizeBytes)) + SLACK_BYTES
}

/** The warning when the largest disk would not fit fully allocated. */
export function tempSpaceWarning(dir: string, availBytes: number, disks: { sizeBytes: number }[]): string {
  const largest = Math.max(...disks.map(d => d.sizeBytes))
  return `Temporary directory ${dir} has ${gb(availBytes)} free and the largest disk is ${gb(largest)}: its download fits only if less than that is allocated in the guest. If it fails, pick a Temporary Storage with more room in the migration dialog`
}

/** Whether a download that stopped had written about all the space the directory had when it started. */
export function tempDirFilledUp(availAtStartBytes: number | null, writtenBytes: number): boolean {
  if (availAtStartBytes === null || availAtStartBytes <= 0) return false
  return writtenBytes >= availAtStartBytes - 64 * 1024 * 1024
}

/** The error of a download that filled the temp directory. */
export function tempDirFullError(dir: string, availAtStartBytes: number, writtenBytes: number): string {
  return `The temporary directory ${dir} filled up: ${gb(availAtStartBytes)} were free when the download started and ${gb(writtenBytes)} had been written when it stopped. Pick a Temporary Storage with more room in the migration dialog, or free space on the node`
}

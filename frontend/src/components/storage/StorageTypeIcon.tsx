'use client'

import { Box } from '@mui/material'

/**
 * Proxmox storage type vocabulary, kept in one place: the inventory storage
 * panel and the deploy wizard label the same types, and Ceph is the one that
 * carries a product logo rather than a glyph.
 */
export function isCephStorage(type: string): boolean {
  return type === 'rbd' || type === 'cephfs'
}

export function storageTypeIcon(type: string): string {
  if (type === 'nfs' || type === 'cifs') return 'ri-folder-shared-fill'
  if (type === 'zfspool' || type === 'zfs') return 'ri-stack-fill'
  if (type === 'lvm' || type === 'lvmthin') return 'ri-hard-drive-2-fill'
  if (type === 'dir') return 'ri-folder-fill'

  return 'ri-hard-drive-fill'
}

export function storageTypeColor(type: string): string {
  if (type === 'nfs' || type === 'cifs') return '#3498db'
  if (type === 'zfspool' || type === 'zfs') return '#2ecc71'
  if (type === 'lvm' || type === 'lvmthin') return '#e67e22'

  return '#95a5a6'
}

interface StorageTypeIconProps {
  type: string
  size?: number
}

export default function StorageTypeIcon({ type, size = 16 }: StorageTypeIconProps) {
  if (isCephStorage(type)) {
    return <img src="/images/ceph-logo.svg" alt="" width={size} height={size} style={{ flexShrink: 0 }} />
  }

  return (
    <Box
      component="i"
      className={storageTypeIcon(type)}
      sx={{ fontSize: size, color: storageTypeColor(type), flexShrink: 0, display: 'inline-flex' }}
    />
  )
}

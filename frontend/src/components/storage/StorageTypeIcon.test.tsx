import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'

import StorageTypeIcon, { isCephStorage, storageTypeIcon } from './StorageTypeIcon'

afterEach(() => { cleanup() })

describe('storage type vocabulary', () => {
  it('treats both Ceph storage types as Ceph', () => {
    expect(isCephStorage('rbd')).toBe(true)
    expect(isCephStorage('cephfs')).toBe(true)
    expect(isCephStorage('zfspool')).toBe(false)
  })

  it('maps the Proxmox storage types onto their glyph', () => {
    expect(storageTypeIcon('nfs')).toBe('ri-folder-shared-fill')
    expect(storageTypeIcon('cifs')).toBe('ri-folder-shared-fill')
    expect(storageTypeIcon('zfspool')).toBe('ri-stack-fill')
    expect(storageTypeIcon('lvmthin')).toBe('ri-hard-drive-2-fill')
    expect(storageTypeIcon('dir')).toBe('ri-folder-fill')
    // Anything unknown still gets a disk rather than nothing.
    expect(storageTypeIcon('iscsi')).toBe('ri-hard-drive-fill')
  })
})

describe('StorageTypeIcon', () => {
  it('renders the Ceph logo for a Ceph pool', () => {
    const { container } = renderWithProviders(<StorageTypeIcon type="rbd" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/ceph-logo.svg')
  })

  it('renders a glyph for every other type', () => {
    const { container } = renderWithProviders(<StorageTypeIcon type="lvmthin" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('i')?.className).toContain('ri-hard-drive-2-fill')
  })
})

import { describe, expect, it } from 'vitest'

import { selectDownloadStorage } from './downloadStorage'

const storage = (name: string, extra = {}) => ({ storage: name, type: 'dir', content: 'import,iso', active: 1, enabled: 1, ...extra })

describe('template import storage selection', () => {
  it('prefers the selected VM storage when it already supports import', () => {
    expect(selectDownloadStorage([storage('a'), storage('target')], 'target', null)).toBe('target')
  })
  it('is stable across PVE response ordering and selects only an existing import area', () => {
    const choices = [storage('backup', { content: 'backup' }), storage('z'), storage('iso', { content: 'iso' }), storage('a')]
    for (let i = 0; i < choices.length; i++) {
      const permuted = [...choices.slice(i), ...choices.slice(0, i)]
      expect(selectDownloadStorage(permuted, 'rbd', null)).toBe('a')
      expect(selectDownloadStorage(permuted.reverse(), 'rbd', null)).toBe('a')
    }
  })
  it('excludes inactive, disabled, block-backed, invisible and read-only storage', () => {
    const choices = [storage('offline', { active: 0 }), storage('disabled', { enabled: 0 }), storage('block', { type: 'rbd' }), storage('library'), storage('outside'), storage('ok')]
    expect(selectDownloadStorage(choices, 'library', new Set(['offline', 'disabled', 'block', 'ok']))).toBe('ok')
  })
  it('returns no candidate instead of repurposing a backup or ISO store', () => {
    expect(selectDownloadStorage([storage('backup', { content: 'backup' }), storage('iso', { content: 'iso,vztmpl' })], 'iso', null)).toBeNull()
    expect(selectDownloadStorage([storage('imports')], 'imports', new Set())).toBeNull()
  })
})

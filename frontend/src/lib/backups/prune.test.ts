import { describe, it, expect } from 'vitest'

import {
  applyMaxfilesTranslation,
  extractKeepLastFromPruneBackups,
  translateMaxfilesToPruneBackups,
} from './prune'

describe('extractKeepLastFromPruneBackups', () => {
  it('returns undefined for missing / null / empty inputs', () => {
    expect(extractKeepLastFromPruneBackups(undefined)).toBeUndefined()
    expect(extractKeepLastFromPruneBackups(null)).toBeUndefined()
    expect(extractKeepLastFromPruneBackups('')).toBeUndefined()
  })

  it('extracts keep-last from a single-rule string', () => {
    expect(extractKeepLastFromPruneBackups('keep-last=30')).toBe(30)
  })

  it('extracts keep-last from a multi-rule string regardless of position', () => {
    expect(extractKeepLastFromPruneBackups('keep-daily=7,keep-last=5')).toBe(5)
    expect(extractKeepLastFromPruneBackups('keep-last=12,keep-weekly=4,keep-monthly=6')).toBe(12)
  })

  it('returns undefined when keep-last is absent from a string', () => {
    expect(extractKeepLastFromPruneBackups('keep-daily=7,keep-weekly=4')).toBeUndefined()
    expect(extractKeepLastFromPruneBackups('ns=prod')).toBeUndefined()
  })

  it('extracts keep-last from an object shape', () => {
    expect(extractKeepLastFromPruneBackups({ 'keep-last': 10, 'keep-daily': 7 })).toBe(10)
    expect(extractKeepLastFromPruneBackups({ 'keep-last': '15' })).toBe(15)
  })

  it('returns undefined when the object has no keep-last', () => {
    expect(extractKeepLastFromPruneBackups({ 'keep-daily': 7 })).toBeUndefined()
    expect(extractKeepLastFromPruneBackups({})).toBeUndefined()
  })

  it('returns undefined when keep-last cannot be parsed as a number', () => {
    expect(extractKeepLastFromPruneBackups({ 'keep-last': 'not-a-number' })).toBeUndefined()
  })
})

describe('translateMaxfilesToPruneBackups', () => {
  it('returns null for missing or non-positive values (keep-all semantics)', () => {
    expect(translateMaxfilesToPruneBackups(undefined)).toBeNull()
    expect(translateMaxfilesToPruneBackups(null)).toBeNull()
    expect(translateMaxfilesToPruneBackups(0)).toBeNull()
    expect(translateMaxfilesToPruneBackups(-5)).toBeNull()
    expect(translateMaxfilesToPruneBackups('not-a-number')).toBeNull()
  })

  it('translates a positive integer into keep-last when no existing policy', () => {
    expect(translateMaxfilesToPruneBackups(30)).toBe('keep-last=30')
  })

  it('accepts numeric strings', () => {
    expect(translateMaxfilesToPruneBackups('30')).toBe('keep-last=30')
  })

  it('replaces only keep-last in an existing string policy', () => {
    expect(translateMaxfilesToPruneBackups(30, 'keep-last=3,keep-daily=7'))
      .toBe('keep-last=30,keep-daily=7')
  })

  it('appends keep-last when the existing string policy has none', () => {
    expect(translateMaxfilesToPruneBackups(30, 'keep-daily=7,keep-weekly=4'))
      .toBe('keep-daily=7,keep-weekly=4,keep-last=30')
  })

  it('preserves the ns= namespace marker on the way through', () => {
    expect(translateMaxfilesToPruneBackups(30, 'keep-last=3,ns=prod'))
      .toBe('keep-last=30,ns=prod')
  })

  it('replaces only keep-last in an existing object policy', () => {
    const out = translateMaxfilesToPruneBackups(30, { 'keep-last': 3, 'keep-daily': 7 })
    // Object iteration preserves insertion order, so we can match a string.
    expect(out).toBe('keep-last=30,keep-daily=7')
  })

  it('appends keep-last when the existing object policy has none', () => {
    expect(translateMaxfilesToPruneBackups(30, { 'keep-daily': 7 }))
      .toBe('keep-daily=7,keep-last=30')
  })

  it('skips empty segments in malformed strings', () => {
    expect(translateMaxfilesToPruneBackups(30, ',keep-daily=7,,'))
      .toBe('keep-daily=7,keep-last=30')
  })
})

describe('applyMaxfilesTranslation', () => {
  it('sets prune-backups when missing and maxfiles is valid', () => {
    const p = new URLSearchParams()
    applyMaxfilesTranslation(p, 30)
    expect(p.get('prune-backups')).toBe('keep-last=30')
  })

  it('does nothing when prune-backups is already set', () => {
    const p = new URLSearchParams()
    p.set('prune-backups', 'keep-daily=14')
    applyMaxfilesTranslation(p, 30)
    expect(p.get('prune-backups')).toBe('keep-daily=14')
  })

  it('does nothing when maxfiles is missing or non-positive', () => {
    const p = new URLSearchParams()
    applyMaxfilesTranslation(p, undefined)
    expect(p.has('prune-backups')).toBe(false)
    applyMaxfilesTranslation(p, 0)
    expect(p.has('prune-backups')).toBe(false)
  })

  it('merges with an existing policy from a previously-saved job', () => {
    const p = new URLSearchParams()
    applyMaxfilesTranslation(p, 30, 'keep-last=3,keep-daily=7')
    expect(p.get('prune-backups')).toBe('keep-last=30,keep-daily=7')
  })
})

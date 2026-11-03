import { describe, expect, it } from 'vitest'
import { createTheme } from '@mui/material'

import { OBJECT_PALETTE, objectChipSx, objectColour, objectTextColour } from './objectColour'

const zones = [{ name: 'web', color: '#3b82f6' }, { name: 'db', color: '' }]

describe('objectColour', () => {
  it('gives pcz-<zone> the colour of its zone', () => {
    expect(objectColour('pcz-web', zones)).toBe('#3b82f6')
  })

  it('falls back to the hash for a pcz object whose zone is unknown or has no colour', () => {
    expect(OBJECT_PALETTE).toContain(objectColour('pcz-gone', zones))
    expect(OBJECT_PALETTE).toContain(objectColour('pcz-db', zones))
  })

  it('is stable: the same name always gives the same colour, with or without zones', () => {
    const first = objectColour('trusted-hosts')
    for (let i = 0; i < 5; i++) expect(objectColour('trusted-hosts', zones)).toBe(first)
    expect(first).toBe(objectColour('trusted-hosts', []))
  })

  it('gives distinct colours to distinct names across a realistic set', () => {
    const names = ['trusted', 'blocklist', 'backup', 'admins', 'vpn', 'sg-db']
    expect(new Set(names.map(n => objectColour(n))).size).toBe(names.length)
    expect(objectColour('trusted')).not.toBe(objectColour('blocklist'))
  })

  it('never picks a grey', () => {
    expect(OBJECT_PALETTE).not.toContain('#64748b')
  })
})

describe('objectChipSx', () => {
  it('borders and tints in the colour, and darkens the text on a light theme only', () => {
    const light = createTheme({ palette: { mode: 'light' } })
    const dark = createTheme({ palette: { mode: 'dark' } })
    expect(objectChipSx('#f59e0b', light).borderColor).toBe('#f59e0b')
    expect(objectChipSx('#f59e0b', light).bgcolor).toMatch(/0\.08\)$/)
    expect(objectTextColour('#f59e0b', dark)).toBe('#f59e0b')
    expect(objectTextColour('#f59e0b', light)).not.toBe('#f59e0b')
  })
})

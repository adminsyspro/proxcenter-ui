import { describe, expect, it } from 'vitest'

import { guestMatchesSearch, guestTagList, tagsSortValue } from './guestSearch'

describe('guestTagList', () => {
  it('splits the PVE semicolon list and keeps an array as is, trimmed and without blanks', () => {
    expect(guestTagList('backup;zeta')).toEqual(['backup', 'zeta'])
    expect(guestTagList(' a ; ;b')).toEqual(['a', 'b'])
    expect(guestTagList(['lab', '', 'zeta'])).toEqual(['lab', 'zeta'])
    expect(guestTagList(null)).toEqual([])
    expect(guestTagList(undefined)).toEqual([])
  })
})

describe('guestMatchesSearch', () => {
  const vm = { name: 'NginX', vmid: 104, type: 'qemu', tags: 'backup;zeta' }

  it('matches on name, vmid and type as before', () => {
    expect(guestMatchesSearch(vm, 'ngin')).toBe(true)
    expect(guestMatchesSearch(vm, '104')).toBe(true)
    expect(guestMatchesSearch(vm, 'qemu')).toBe(true)
    expect(guestMatchesSearch(vm, 'rocky')).toBe(false)
  })

  // #937: typing a tag in the inventory search found nothing in the tree.
  it('matches on any tag, as a PVE string or as a list', () => {
    expect(guestMatchesSearch(vm, 'zeta')).toBe(true)
    expect(guestMatchesSearch(vm, 'back')).toBe(true)
    expect(guestMatchesSearch({ ...vm, tags: ['lab', 'Zeta'] }, 'zeta')).toBe(true)
    expect(guestMatchesSearch({ ...vm, tags: null }, 'zeta')).toBe(false)
  })

  it('matches everything on an empty query and tolerates missing fields', () => {
    expect(guestMatchesSearch({}, '')).toBe(true)
    expect(guestMatchesSearch({}, 'x')).toBe(false)
  })
})

describe('tagsSortValue', () => {
  it('joins the tags as displayed, lowercased, and gives an empty string without tags', () => {
    expect(tagsSortValue(['Backup', 'zeta'])).toBe('backup, zeta')
    expect(tagsSortValue('lab;zeta')).toBe('lab, zeta')
    expect(tagsSortValue([])).toBe('')
    expect(tagsSortValue(undefined)).toBe('')
  })

  it('orders alphabetically once compared as strings', () => {
    const rows = [['zeta'], ['mid'], ['backup', 'zeta'], [], ['community-script', 'os']]
    const sorted = [...rows].sort((a, b) => tagsSortValue(a).localeCompare(tagsSortValue(b)))
    expect(sorted).toEqual([[], ['backup', 'zeta'], ['community-script', 'os'], ['mid'], ['zeta']])
  })
})

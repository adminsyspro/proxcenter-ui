import { describe, it, expect } from 'vitest'

import { buildSmartView } from './smartView'

// Measured on a real QEMU disk: no `attributes` array at all.
const TEXT_RESPONSE = {
  health: 'OK',
  type: 'text',
  text: 'Current Drive Temperature:     0 C\nDrive Trip Temperature:        0 C\n\n',
}

const ATTR_RESPONSE = {
  health: 'PASSED',
  type: 'ata',
  attributes: [
    { id: 5, name: 'Reallocated_Sector_Ct', value: 100, worst: 100, threshold: 10, raw: '0', flags: 'PO--CK' },
    { id: 197, name: 'Current_Pending_Sector', value: 90, worst: 80, threshold: 95, raw: '4', flags: 'PO--CK' },
  ],
}

describe('buildSmartView', () => {
  it('reports unavailable when SMART is null', () => {
    // A hardware RAID controller hides the disk and PVE returns nothing.
    expect(buildSmartView(null)).toEqual({ kind: 'unavailable' })
    expect(buildSmartView(undefined)).toEqual({ kind: 'unavailable' })
  })

  it('reports unavailable for a non-object payload', () => {
    expect(buildSmartView('nope')).toEqual({ kind: 'unavailable' })
  })

  it('uses the text branch when there is no attributes array', () => {
    const view = buildSmartView(TEXT_RESPONSE)

    expect(view.kind).toBe('text')
    if (view.kind !== 'text') throw new Error('wrong branch')
    expect(view.health).toBe('OK')
    expect(view.text).toContain('Current Drive Temperature')
  })

  it('uses the attributes branch when the array is present and non-empty', () => {
    const view = buildSmartView(ATTR_RESPONSE)

    expect(view.kind).toBe('attributes')
    if (view.kind !== 'attributes') throw new Error('wrong branch')
    expect(view.rows).toHaveLength(2)
    expect(view.rows[0]).toMatchObject({ id: 5, name: 'Reallocated_Sector_Ct', value: 100, raw: '0' })
  })

  it('flags an attribute whose value dropped to or below its threshold', () => {
    const view = buildSmartView(ATTR_RESPONSE)

    if (view.kind !== 'attributes') throw new Error('wrong branch')
    expect(view.rows[0].failing).toBe(false)
    expect(view.rows[1].failing).toBe(true)
  })

  it('never flags an attribute with a missing threshold', () => {
    const view = buildSmartView({ health: 'OK', attributes: [{ id: 1, name: 'X', value: 1 }] })

    if (view.kind !== 'attributes') throw new Error('wrong branch')
    expect(view.rows[0].failing).toBe(false)
  })

  it('falls back to the text branch when attributes is an empty array', () => {
    const view = buildSmartView({ health: 'OK', type: 'text', text: 'hello', attributes: [] })

    expect(view.kind).toBe('text')
  })

  it('falls back to unavailable when there is neither attributes nor text', () => {
    expect(buildSmartView({ health: 'OK', type: 'ata' })).toEqual({ kind: 'unavailable' })
  })

  it('keeps a null health rather than inventing one', () => {
    const view = buildSmartView({ text: 'hello' })

    if (view.kind !== 'text') throw new Error('wrong branch')
    expect(view.health).toBeNull()
  })

  it('names an unnamed attribute by its id so the row is never blank', () => {
    const view = buildSmartView({ health: 'OK', attributes: [{ id: 42, value: 1 }] })

    if (view.kind !== 'attributes') throw new Error('wrong branch')
    expect(view.rows[0].name).toBe('42')
  })
})

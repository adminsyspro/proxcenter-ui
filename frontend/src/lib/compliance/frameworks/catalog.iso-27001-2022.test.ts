import { describe, it, expect } from 'vitest'
import { ISO_27001_2022_CONTROLS } from './catalog.iso-27001-2022'

describe('ISO/IEC 27001:2022 catalogue', () => {
  it('has exactly 93 controls', () => {
    expect(ISO_27001_2022_CONTROLS.length).toBe(93)
  })

  it('has 37 Organizational controls (A.5)', () => {
    expect(ISO_27001_2022_CONTROLS.filter(c => c.family === 'Organizational').length).toBe(37)
  })

  it('has 8 People controls (A.6)', () => {
    expect(ISO_27001_2022_CONTROLS.filter(c => c.family === 'People').length).toBe(8)
  })

  it('has 14 Physical controls (A.7)', () => {
    expect(ISO_27001_2022_CONTROLS.filter(c => c.family === 'Physical').length).toBe(14)
  })

  it('has 34 Technological controls (A.8)', () => {
    expect(ISO_27001_2022_CONTROLS.filter(c => c.family === 'Technological').length).toBe(34)
  })

  it('every id matches /^A\\.[5-8]\\.\\d+$/', () => {
    for (const c of ISO_27001_2022_CONTROLS) {
      expect(c.id).toMatch(/^A\.[5-8]\.\d+$/)
    }
  })

  it('every control has id, title, and family', () => {
    for (const c of ISO_27001_2022_CONTROLS) {
      expect(typeof c.id).toBe('string')
      expect(c.id.length).toBeGreaterThan(0)
      expect(typeof c.title).toBe('string')
      expect(c.title.length).toBeGreaterThan(0)
      expect(typeof c.family).toBe('string')
      expect(c.family.length).toBeGreaterThan(0)
    }
  })

  it('ids are unique', () => {
    const ids = ISO_27001_2022_CONTROLS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every Organizational control has an id starting A.5.', () => {
    for (const c of ISO_27001_2022_CONTROLS.filter(c => c.family === 'Organizational')) {
      expect(c.id).toMatch(/^A\.5\./)
    }
  })

  it('every People control has an id starting A.6.', () => {
    for (const c of ISO_27001_2022_CONTROLS.filter(c => c.family === 'People')) {
      expect(c.id).toMatch(/^A\.6\./)
    }
  })

  it('every Physical control has an id starting A.7.', () => {
    for (const c of ISO_27001_2022_CONTROLS.filter(c => c.family === 'Physical')) {
      expect(c.id).toMatch(/^A\.7\./)
    }
  })

  it('every Technological control has an id starting A.8.', () => {
    for (const c of ISO_27001_2022_CONTROLS.filter(c => c.family === 'Technological')) {
      expect(c.id).toMatch(/^A\.8\./)
    }
  })
})

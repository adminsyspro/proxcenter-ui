import { describe, it, expect } from 'vitest'

import { normalizeVlanTrunks } from './vlanTrunks'

describe('normalizeVlanTrunks', () => {
  it('keeps the Proxmox VE syntax as it is', () => {
    expect(normalizeVlanTrunks('225;230;605-606')).toEqual({ value: '225;230;605-606', valid: true })
  })

  it('reads commas and spaces as separators, never letting a comma into the netN string', () => {
    expect(normalizeVlanTrunks(' 225, 230  605-606;')).toEqual({ value: '225;230;605-606', valid: true })
  })

  it('treats an empty field as no trunks', () => {
    expect(normalizeVlanTrunks('  ')).toEqual({ value: '', valid: true })
  })

  it.each(['0', '4095', '30-20', 'abc', '10-', '1-4095', '10;x'])('refuses %s', (input) => {
    expect(normalizeVlanTrunks(input).valid).toBe(false)
  })

  it('accepts the bounds 1 and 4094', () => {
    expect(normalizeVlanTrunks('1;4094;1-4094').valid).toBe(true)
  })
})

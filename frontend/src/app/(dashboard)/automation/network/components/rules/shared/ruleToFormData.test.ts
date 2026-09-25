import { describe, expect, it } from 'vitest'

import { ruleToFormData } from './ruleToFormData'

describe('ruleToFormData', () => {
  it('copies every field of a fully configured rule', () => {
    expect(ruleToFormData({
      pos: 0, type: 'out', action: 'DROP', enable: 1, proto: 'tcp', dport: '443', sport: '1024',
      source: '10.0.0.0/8', dest: '10.0.0.5', macro: 'SSH', iface: 'net0', log: 'warning', comment: 'c',
    })).toEqual({
      type: 'out', action: 'DROP', enable: 1, proto: 'tcp', dport: '443', sport: '1024',
      source: '10.0.0.0/8', dest: '10.0.0.5', macro: 'SSH', iface: 'net0', log: 'warning', comment: 'c',
    })
  })

  it('falls back to PVE defaults and keeps a rule without enable disabled (#1015)', () => {
    expect(ruleToFormData({ pos: 1, type: '', action: '' })).toEqual({
      type: 'in', action: 'ACCEPT', enable: 0, proto: '', dport: '', sport: '',
      source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: '',
    })
  })
})

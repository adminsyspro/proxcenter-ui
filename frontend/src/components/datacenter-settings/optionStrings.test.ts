import { describe, it, expect } from 'vitest'

import { mergeKV, parseKV, tagListValue } from './optionStrings'

describe('parseKV', () => {
  it('reads the object form with numbers and arrays', () => {
    expect(parseKV({ ha: 'static', 'ha-rebalance-on-start': 1 }, ['ha', 'ha-rebalance-on-start']))
      .toEqual({ ha: 'static', 'ha-rebalance-on-start': '1' })
  })

  it('reads the string form and keeps = inside a value', () => {
    expect(parseKV('type=secure,network=10.0.0.0/24', ['type', 'network'])).toEqual({ type: 'secure', network: '10.0.0.0/24' })
    expect(parseKV('rp=a=b', ['rp'])).toEqual({ rp: 'a=b' })
  })

  it('gives an empty string for every asked key that is missing', () => {
    expect(parseKV(undefined, ['lower', 'upper'])).toEqual({ lower: '', upper: '' })
  })
})

describe('mergeKV', () => {
  it('keeps the sub-keys the form does not show (crs ha-auto-rebalance)', () => {
    const raw = { ha: 'dynamic', 'ha-auto-rebalance': 1, 'ha-rebalance-on-start': 1 }
    expect(mergeKV(raw, { ha: 'static', 'ha-rebalance-on-start': '' })).toBe('ha=static,ha-auto-rebalance=1')
  })

  it('joins an array value with ; (user-allow-list)', () => {
    expect(mergeKV({ 'user-allow': 'list', 'user-allow-list': ['a', 'b'] }, { 'user-allow': 'existing' }))
      .toBe('user-allow=existing,user-allow-list=a;b')
  })

  it('drops a key whose field is emptied and answers empty when nothing is left', () => {
    expect(mergeKV({ 'user-allow': 'list' }, { 'user-allow': '', 'user-allow-list': '' })).toBe('')
  })

  it('merges over the string form too', () => {
    expect(mergeKV('rp=x,allow-subdomains=1', { rp: 'y', origin: 'https://h' })).toBe('rp=y,allow-subdomains=1,origin=https://h')
  })

  it('builds from scratch when PVE had no value', () => {
    expect(mergeKV(undefined, { lower: '5000', upper: '' })).toBe('lower=5000')
  })
})

describe('tagListValue', () => {
  it('turns the array PVE returns into the ; list it accepts (#1207)', () => {
    expect(tagListValue(['ha-on', 'virt-ct'])).toBe('ha-on;virt-ct')
  })

  it('normalises a list typed with commas or spaces', () => {
    expect(tagListValue('a, b c;d')).toBe('a;b;c;d')
  })

  it('answers empty for nothing', () => {
    expect(tagListValue(undefined)).toBe('')
  })
})

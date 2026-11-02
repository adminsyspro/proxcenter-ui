/**
 * Settings form model: the bounds are the orchestrator's (internal/microseg/validate.go),
 * the log rate limit is a small form built into PVE's property string, only the
 * fields the admin changed are sent.
 */

import { describe, expect, it } from 'vitest'

import type { MicrosegSettings } from '@/lib/microseg/types'

import {
  SETTING_BOUNDS, buildRateLimit, changedUpdate, formFromSettings, parseRateLimit, validateSettingsForm,
} from './settingsModel'

const base: MicrosegSettings = {
  light_interval_sec: 300, ips_interval_sec: 900, full_interval_sec: 1800, log_interval_sec: 60, ready_after_hours: 24,
  write_cap: 50, observe_log_rate_limit: '', original_log_rate_limit: '', notify_drift: true, notify_paused: true,
  notify_unprotected: true, notify_blocked: true,
}

describe('bounds', () => {
  it('are the orchestrator bounds', () => {
    expect(SETTING_BOUNDS).toEqual({
      light_interval_sec: [60, 3600], ips_interval_sec: [300, 86400], full_interval_sec: [600, 86400],
      log_interval_sec: [30, 600], ready_after_hours: [1, 168], write_cap: [1, 500],
    })
  })

  for (const [field, [lo, hi]] of Object.entries(SETTING_BOUNDS)) {
    it(`${field} accepts ${lo} and ${hi}, refuses ${lo - 1} and ${hi + 1}, a fraction and text`, () => {
      const at = (value: string) => validateSettingsForm({ ...formFromSettings('zone-', base), [field]: value })
      expect(at(String(lo))[field]).toBeUndefined()
      expect(at(String(hi))[field]).toBeUndefined()
      expect(at(String(lo - 1))[field]).toEqual({ key: 'range', values: { min: lo, max: hi } })
      expect(at(String(hi + 1))[field]).toBeDefined()
      expect(at(`${lo}.5`)[field]).toBeDefined()
      expect(at('abc')[field]).toBeDefined()
      expect(at('')[field]).toBeDefined()
    })
  }
})

describe('tag prefix', () => {
  const at = (tagPrefix: string) => validateSettingsForm({ ...formFromSettings('zone-', base), tagPrefix }).tagPrefix
  it('is 1 to 16 of a-z 0-9 _ . + -', () => {
    expect(at('zone-')).toBeUndefined()
    expect(at('a_b.c+d-9')).toBeUndefined()
    expect(at('x'.repeat(16))).toBeUndefined()
    expect(at('')).toBeDefined()
    expect(at('x'.repeat(17))).toBeDefined()
    expect(at('Zone-')).toBeDefined()
    expect(at('zo ne')).toBeDefined()
  })
})

describe('log rate limit form', () => {
  it('builds enable=1,rate=N/unit,burst=N', () => {
    expect(buildRateLimit({ rate: '10', rateUnit: 'second', burst: '20' })).toBe('enable=1,rate=10/second,burst=20')
    expect(buildRateLimit({ rate: '5', rateUnit: 'minute', burst: '0' })).toBe('enable=1,rate=5/minute,burst=0')
  })

  it('is empty when both fields are empty (PVE left untouched)', () => {
    expect(buildRateLimit({ rate: '', rateUnit: 'second', burst: '' })).toBe('')
  })

  it('round trips through the form', () => {
    for (const unit of ['second', 'minute', 'hour', 'day'] as const) {
      const value = `enable=1,rate=7/${unit},burst=13`
      const parsed = parseRateLimit(value)
      expect(parsed).toEqual({ rate: '7', rateUnit: unit, burst: '13' })
      expect(buildRateLimit(parsed)).toBe(value)
    }
  })

  it('reads the keys in any order and an empty value as an empty form', () => {
    expect(parseRateLimit('burst=4,enable=1,rate=2/hour')).toEqual({ rate: '2', rateUnit: 'hour', burst: '4' })
    expect(parseRateLimit('')).toEqual({ rate: '', rateUnit: 'second', burst: '' })
    expect(parseRateLimit('nonsense')).toEqual({ rate: '', rateUnit: 'second', burst: '' })
  })

  it('needs both numbers when one is given, and whole numbers', () => {
    const at = (rate: string, burst: string) => validateSettingsForm({ ...formFromSettings('zone-', base), rate, burst })
    expect(at('', '').rate).toBeUndefined()
    expect(at('10', '20').rate).toBeUndefined()
    expect(at('10', '').burst).toEqual({ key: 'rateBoth' })
    expect(at('', '20').rate).toEqual({ key: 'rateBoth' })
    expect(at('0', '20').rate).toEqual({ key: 'rateNumber' })
    expect(at('1.5', '20').rate).toEqual({ key: 'rateNumber' })
    expect(at('10', '-1').burst).toEqual({ key: 'burstNumber' })
    expect(at('10', '0').burst).toBeUndefined()
  })
})

describe('self IPs', () => {
  const at = (selfIps: string) => validateSettingsForm({ ...formFromSettings('zone-', base), selfIps }).selfIps
  it('accepts IPv4 and IPv6 separated by commas or spaces, or nothing', () => {
    expect(at('')).toBeUndefined()
    expect(at('10.0.0.5')).toBeUndefined()
    expect(at('10.0.0.5, 10.0.0.6 fd00::1')).toBeUndefined()
  })
  it('names the first bad address', () => {
    expect(at('10.0.0.5, 10.0.0.300')).toEqual({ key: 'selfIpInvalid', values: { ip: '10.0.0.300' } })
    expect(at('not-an-ip')).toEqual({ key: 'selfIpInvalid', values: { ip: 'not-an-ip' } })
    expect(at('10.0.0.0/24')).toBeDefined()
  })
  it('holds at most 16', () => {
    const ips = (n: number) => Array.from({ length: n }, (_, i) => `10.0.0.${i + 1}`).join(',')
    expect(at(ips(16))).toBeUndefined()
    expect(at(ips(17))).toEqual({ key: 'selfIpTooMany', values: { max: 16 } })
  })
})

describe('changed fields', () => {
  const baseline = formFromSettings('zone-', { ...base, self_ips: ['10.0.0.5'], observe_log_rate_limit: 'enable=1,rate=10/second,burst=20' })

  it('sends nothing when nothing changed', () => {
    expect(changedUpdate(baseline, { ...baseline })).toBeNull()
  })

  it('sends only what changed', () => {
    expect(changedUpdate(baseline, { ...baseline, light_interval_sec: '120' })).toEqual({ settings: { light_interval_sec: 120 } })
    expect(changedUpdate(baseline, { ...baseline, tagPrefix: 'seg-' })).toEqual({ tag_prefix: 'seg-' })
    expect(changedUpdate(baseline, { ...baseline, notify_drift: false, write_cap: '10' })).toEqual({ settings: { write_cap: 10, notify_drift: false } })
  })

  it('sends the log rate limit built, or empty to leave PVE alone again', () => {
    expect(changedUpdate(baseline, { ...baseline, rate: '50', rateUnit: 'minute' }))
      .toEqual({ settings: { observe_log_rate_limit: 'enable=1,rate=50/minute,burst=20' } })
    expect(changedUpdate(baseline, { ...baseline, rate: '', burst: '' })).toEqual({ settings: { observe_log_rate_limit: '' } })
  })

  it('sends the self IPs as a list, an empty list clears them', () => {
    expect(changedUpdate(baseline, { ...baseline, selfIps: '10.0.0.5, 10.0.0.9' })).toEqual({ settings: { self_ips: ['10.0.0.5', '10.0.0.9'] } })
    expect(changedUpdate(baseline, { ...baseline, selfIps: '' })).toEqual({ settings: { self_ips: [] } })
    expect(changedUpdate(baseline, { ...baseline, selfIps: ' 10.0.0.5 ,' })).toBeNull()
  })

  it('keeps a log rate limit it cannot show untouched', () => {
    const odd = formFromSettings('zone-', { ...base, observe_log_rate_limit: 'enable=0' })
    expect(changedUpdate(odd, { ...odd, write_cap: '20' })).toEqual({ settings: { write_cap: 20 } })
  })

  it('fills defaults for a policy whose settings are not loaded', () => {
    const empty = formFromSettings('zone-', {} as MicrosegSettings)
    expect(empty.light_interval_sec).toBe('300')
    expect(empty.notify_drift).toBe(true)
    expect(empty.selfIps).toBe('')
  })
})

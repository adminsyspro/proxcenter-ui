// The Settings form of the Micro-segmentation tab, as plain data: what the
// inputs hold (strings), what is wrong with them, and what to send. The bounds
// are the orchestrator's (internal/microseg/validate.go settingBounds), so a
// mistake is shown at once instead of coming back as a 400; the server stays
// the authority.

import type { MicrosegSettings, PolicyUpdate } from '@/lib/microseg/types'

import { isIpAddress } from './zoneForm'

export type SettingNumberKey =
  | 'light_interval_sec' | 'ips_interval_sec' | 'full_interval_sec' | 'log_interval_sec' | 'ready_after_hours' | 'write_cap'

export const SETTING_NUMBER_KEYS: SettingNumberKey[] = [
  'light_interval_sec', 'ips_interval_sec', 'full_interval_sec', 'log_interval_sec', 'ready_after_hours', 'write_cap',
]

/** [min, max] of each load setting. */
export const SETTING_BOUNDS: Record<SettingNumberKey, [number, number]> = {
  light_interval_sec: [60, 3600],
  ips_interval_sec: [300, 86400],
  full_interval_sec: [600, 86400],
  log_interval_sec: [30, 600],
  ready_after_hours: [1, 168],
  write_cap: [1, 500],
}

export const SETTING_UNITS: Record<SettingNumberKey, 'seconds' | 'hours' | 'writes'> = {
  light_interval_sec: 'seconds', ips_interval_sec: 'seconds', full_interval_sec: 'seconds', log_interval_sec: 'seconds',
  ready_after_hours: 'hours', write_cap: 'writes',
}

const DEFAULTS: Record<SettingNumberKey, number> = {
  light_interval_sec: 300, ips_interval_sec: 900, full_interval_sec: 1800, log_interval_sec: 60, ready_after_hours: 24, write_cap: 50,
}

export const RATE_UNITS = ['second', 'minute', 'hour', 'day'] as const
export type RateUnit = (typeof RATE_UNITS)[number]

export const NOTIFY_KEYS = ['notify_drift', 'notify_paused', 'notify_unprotected', 'notify_blocked'] as const
export type NotifyKey = (typeof NOTIFY_KEYS)[number]

export const MAX_SELF_IPS = 16
const TAG_PREFIX_RE = /^[a-z0-9_.+-]{1,16}$/

export type RateLimitForm = { rate: string; rateUnit: RateUnit; burst: string }

export type SettingsForm = RateLimitForm & Record<SettingNumberKey, string> & Record<NotifyKey, boolean> & {
  tagPrefix: string
  /** Comma or space separated addresses. */
  selfIps: string
}

/** A problem with one field: a key under microsegPilot.settings.validation and its values. */
export type FieldProblem = { key: string; values?: Record<string, string | number> }
export type SettingsProblems = Partial<Record<keyof SettingsForm, FieldProblem>>

const EMPTY_RATE: RateLimitForm = { rate: '', rateUnit: 'second', burst: '' }

/** The form of a stored `observe_log_rate_limit`. What the form cannot show (enable=0, no rate...) reads as empty. */
export function parseRateLimit(value: string): RateLimitForm {
  const parts = new Map(
    (value || '').split(',').map(p => p.trim().split('=') as [string, string | undefined]).filter(([, v]) => v !== undefined),
  )
  const rate = /^([1-9]\d{0,8})\/(second|minute|hour|day)$/.exec(parts.get('rate') ?? '')
  if (!rate) return { ...EMPTY_RATE }
  const burst = /^(0|[1-9]\d{0,8})$/.exec(parts.get('burst') ?? '')
  return { rate: rate[1], rateUnit: rate[2] as RateUnit, burst: burst ? burst[1] : '' }
}

/** The PVE property string of the form; empty when both numbers are empty (the cluster option is left alone). */
export function buildRateLimit({ rate, rateUnit, burst }: RateLimitForm): string {
  if (rate === '' && burst === '') return ''
  return `enable=1,rate=${rate}/${rateUnit},burst=${burst}`
}

export function parseSelfIps(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))]
}

export function formFromSettings(tagPrefix: string, settings: Partial<MicrosegSettings> | undefined): SettingsForm {
  const s = settings ?? {}
  const numbers = Object.fromEntries(SETTING_NUMBER_KEYS.map(k => [k, String(s[k] || DEFAULTS[k])])) as Record<SettingNumberKey, string>
  const notify = Object.fromEntries(NOTIFY_KEYS.map(k => [k, s[k] ?? true])) as Record<NotifyKey, boolean>
  return {
    tagPrefix,
    ...numbers,
    ...parseRateLimit(s.observe_log_rate_limit ?? ''),
    selfIps: (s.self_ips ?? []).join(', '),
    ...notify,
  }
}

const isWhole = (value: string) => /^\d+$/.test(value.trim())

function validateRate(form: SettingsForm, problems: SettingsProblems) {
  const rate = form.rate.trim()
  const burst = form.burst.trim()
  if (rate !== '' && !/^[1-9]\d{0,8}$/.test(rate)) problems.rate = { key: 'rateNumber' }
  if (burst !== '' && !/^(0|[1-9]\d{0,8})$/.test(burst)) problems.burst = { key: 'burstNumber' }
  if (rate === '' && burst !== '' && !problems.burst) problems.rate = { key: 'rateBoth' }
  if (burst === '' && rate !== '' && !problems.rate) problems.burst = { key: 'rateBoth' }
}

function validateSelfIps(text: string, problems: SettingsProblems) {
  const ips = parseSelfIps(text)
  const bad = ips.find(ip => !isIpAddress(ip))
  if (bad !== undefined) problems.selfIps = { key: 'selfIpInvalid', values: { ip: bad } }
  else if (ips.length > MAX_SELF_IPS) problems.selfIps = { key: 'selfIpTooMany', values: { max: MAX_SELF_IPS } }
}

export function validateSettingsForm(form: SettingsForm): SettingsProblems {
  const problems: SettingsProblems = {}
  if (!TAG_PREFIX_RE.test(form.tagPrefix)) problems.tagPrefix = { key: 'tagPrefix' }
  for (const key of SETTING_NUMBER_KEYS) {
    const [min, max] = SETTING_BOUNDS[key]
    const value = form[key].trim()
    if (!isWhole(value) || Number(value) < min || Number(value) > max) problems[key] = { key: 'range', values: { min, max } }
  }
  validateRate(form, problems)
  validateSelfIps(form.selfIps, problems)
  return problems
}

type Changes = Pick<PolicyUpdate, 'tag_prefix' | 'settings'>

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i])

/**
 * The fields of `form` that differ from `baseline`, ready for PUT /policy (the
 * version is added by the caller), or null when nothing changed. The baseline
 * is the form as it was opened, so a draft that moved meanwhile never gets an
 * untouched field overwritten.
 */
export function changedUpdate(baseline: SettingsForm, form: SettingsForm): Changes | null {
  const settings: NonNullable<PolicyUpdate['settings']> = {}
  for (const key of SETTING_NUMBER_KEYS) {
    if (form[key].trim() !== baseline[key].trim()) settings[key] = Number(form[key])
  }
  for (const key of NOTIFY_KEYS) {
    if (form[key] !== baseline[key]) settings[key] = form[key]
  }
  const rateChanged = form.rate.trim() !== baseline.rate || form.rateUnit !== baseline.rateUnit || form.burst.trim() !== baseline.burst
  if (rateChanged) settings.observe_log_rate_limit = buildRateLimit({ rate: form.rate.trim(), rateUnit: form.rateUnit, burst: form.burst.trim() })
  const ips = parseSelfIps(form.selfIps)
  if (!sameList(ips, parseSelfIps(baseline.selfIps))) settings.self_ips = ips

  const out: Changes = {}
  if (form.tagPrefix !== baseline.tagPrefix) out.tag_prefix = form.tagPrefix
  if (Object.keys(settings).length > 0) out.settings = settings
  return Object.keys(out).length > 0 ? out : null
}

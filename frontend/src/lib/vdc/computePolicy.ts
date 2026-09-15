import { extractCustomCpuModels } from '@/lib/inventory/cpuModels'

export type CpuModelMode = 'unrestricted' | 'custom' | 'selected'

export interface VdcComputePolicy {
  cpuModelMode: CpuModelMode
  /** Only meaningful in `selected` mode. Model names as PVE expects them in `cpu`. */
  cpuAllowedModels: string[]
  /** Pre-selected model for the Create VM wizard. Null = first allowed / UI default. */
  cpuDefaultModel: string | null
  /** When false, tenants may not set NUMA, CPU flags, cpulimit or cpuunits. */
  cpuAdvancedSettings: boolean
}

export const DEFAULT_COMPUTE_POLICY: VdcComputePolicy = {
  cpuModelMode: 'unrestricted',
  cpuAllowedModels: [],
  cpuDefaultModel: null,
  cpuAdvancedSettings: true,
}

const MODES: ReadonlySet<string> = new Set<CpuModelMode>(['unrestricted', 'custom', 'selected'])

/** PVE cpu model / flag names: letters, digits, `-`, `_`, `.`, `+`. */
const MODEL_RE = /^[A-Za-z0-9._+-]{1,64}$/

/**
 * Turn a partial, untrusted input (API body) into a complete policy. Unknown
 * modes fall back to `unrestricted`; models that are not plausible PVE names
 * are dropped so a stray value can never reach a `cpu=` line.
 */
export function normalizeComputePolicyInput(
  input: Partial<VdcComputePolicy> | null | undefined,
  base: VdcComputePolicy = DEFAULT_COMPUTE_POLICY,
): VdcComputePolicy {
  if (!input) return { ...base, cpuAllowedModels: [...base.cpuAllowedModels] }
  const mode: CpuModelMode = MODES.has(String(input.cpuModelMode)) ? (input.cpuModelMode as CpuModelMode) : base.cpuModelMode
  const models = Array.isArray(input.cpuAllowedModels)
    ? [...new Set(input.cpuAllowedModels.map(m => String(m).trim()).filter(m => MODEL_RE.test(m)))]
    : [...base.cpuAllowedModels]
  const rawDefault = input.cpuDefaultModel === undefined ? base.cpuDefaultModel : input.cpuDefaultModel
  const defaultModel = typeof rawDefault === 'string' && MODEL_RE.test(rawDefault.trim()) ? rawDefault.trim() : null
  const advanced = typeof input.cpuAdvancedSettings === 'boolean' ? input.cpuAdvancedSettings : base.cpuAdvancedSettings
  return {
    cpuModelMode: mode,
    cpuAllowedModels: mode === 'selected' ? models : [],
    cpuDefaultModel: defaultModel,
    cpuAdvancedSettings: advanced,
  }
}

export function isPolicyRestrictive(policy: VdcComputePolicy | null | undefined): boolean {
  if (!policy) return false
  return policy.cpuModelMode !== 'unrestricted' || policy.cpuAdvancedSettings === false
}

/**
 * The name a `/capabilities/qemu/cpu` entry carries in a guest `cpu=` line:
 * PVE lists custom models under their bare name with `custom: 1`, but the
 * config always references them as `custom-<name>`.
 */
export function normalizeCpuModelName(entry: unknown): string | null {
  const e = entry as { name?: unknown; custom?: unknown } | null
  const name = typeof e?.name === 'string' ? e.name.trim() : ''
  if (!name) return null
  const isCustom = e?.custom === 1 || e?.custom === true || name.startsWith('custom-')
  if (!isCustom) return name
  return name.startsWith('custom-') ? name : `custom-${name}`
}

/**
 * Cluster CPU capabilities are only needed to judge a model change under
 * the `custom` mode. `fetchCapabilities` is called at most once and any
 * failure yields `undefined`, which leaves the allowed set empty: the check
 * fails closed rather than letting an unknown model through.
 */
export async function loadCpuCapabilitiesIfNeeded(
  policy: VdcComputePolicy | null | undefined,
  patch: { cpu?: unknown },
  fetchCapabilities: () => Promise<unknown>,
): Promise<unknown> {
  if (!policy || policy.cpuModelMode !== 'custom') return undefined
  if (patch.cpu === undefined || patch.cpu === null || String(patch.cpu) === '') return undefined
  try {
    return await fetchCapabilities()
  } catch {
    return undefined
  }
}

/**
 * The set of CPU models a tenant may pick, or null when unrestricted.
 * `clusterCapabilities` is the raw `/nodes/{node}/capabilities/qemu/cpu`
 * answer, only consulted in `custom` mode.
 */
export function resolveAllowedCpuModels(
  policy: VdcComputePolicy,
  clusterCapabilities?: unknown,
): Set<string> | null {
  switch (policy.cpuModelMode) {
    case 'custom':
      return new Set(extractCustomCpuModels(clusterCapabilities))
    case 'selected':
      return new Set(policy.cpuAllowedModels)
    default:
      return null
  }
}

/** Split a PVE `cpu` property string: `host,flags=+aes;-pcid,hidden=1`. */
// A PVE property key: letters, digits, dashes and underscores, starting with a
// letter. Anything else in a user-supplied `cpu` string is dropped, which also
// keeps `__proto__` and friends out of the object built below.
const CPU_PROPERTY_KEY = /^[a-z][a-z0-9_-]*$/i
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

export function parseCpuProperty(raw: string): { model: string; flags: string[]; extra: Record<string, string> } {
  const parts = String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  let model = ''
  const entries: Array<[string, string]> = []
  let flags: string[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) {
      if (!model) model = part
      continue
    }
    const key = part.slice(0, eq)
    const value = part.slice(eq + 1)
    if (key === 'cputype') { model = value; continue }
    if (key === 'flags') { flags = value.split(';').map(f => f.trim()).filter(Boolean); continue }
    if (!CPU_PROPERTY_KEY.test(key) || FORBIDDEN_KEYS.has(key.toLowerCase())) continue
    entries.push([key, value])
  }
  return { model, flags, extra: Object.fromEntries(entries) }
}

export type CpuPolicyVerdict = { ok: true } | { ok: false; error: string }

/** PVE's own default when a guest carries no `cpu` line. */
export const PVE_DEFAULT_CPU_MODEL = 'kvm64'

const ADVANCED_KEYS = ['numa', 'cpulimit', 'cpuunits'] as const

function listedKeys(raw: unknown): string[] {
  return typeof raw === 'string' ? raw.split(',').map(s => s.trim()).filter(Boolean) : []
}

function isPresent(v: unknown): boolean {
  return v !== undefined && v !== null && String(v) !== ''
}

/**
 * The model a guest gets when the tenant did not (or may not) choose one:
 * the vDC default if it is inside the allowed set, else the first allowed
 * model, else null when the set is empty (nothing can be created then).
 * Returns undefined for an unrestricted model policy: keep the caller's value.
 */
export function pickPolicyDefaultModel(
  policy: VdcComputePolicy | null | undefined,
  clusterCapabilities?: unknown,
): string | null | undefined {
  if (!policy) return undefined
  const allowed = resolveAllowedCpuModels(policy, clusterCapabilities)
  if (!allowed) return undefined
  if (policy.cpuDefaultModel && allowed.has(policy.cpuDefaultModel)) return policy.cpuDefaultModel
  const first = [...allowed].sort()[0]
  return first ?? null
}

/**
 * Check a config patch (create, config PUT or deploy hardware) against a vDC
 * compute policy. Only the keys present in `patch` are judged, so a request
 * that leaves the CPU alone always passes. `currentModel` is the guest's
 * existing model: keeping it is allowed even outside the set, which is how
 * a template deployed with a provider model survives later edits of other
 * fields (only a CHANGE of model must land inside the allowed set).
 *
 * With advanced settings locked, `numa`, `cpulimit` and `cpuunits` are refused
 * whatever their value, and so is their removal through `delete`/`revert`: a
 * neutral `cpulimit=0` would otherwise lift a cap the provider set on purpose.
 */
export function validateCpuAgainstPolicy(
  policy: VdcComputePolicy | null | undefined,
  patch: { cpu?: unknown; numa?: unknown; cpulimit?: unknown; cpuunits?: unknown; delete?: unknown; revert?: unknown },
  opts: { clusterCapabilities?: unknown; currentModel?: string | null } = {},
): CpuPolicyVerdict {
  if (!policy || !isPolicyRestrictive(policy)) return { ok: true }

  const allowed = resolveAllowedCpuModels(policy, opts.clusterCapabilities)
  const removed = [...listedKeys(patch.delete), ...listedKeys(patch.revert)]

  if (isPresent(patch.cpu)) {
    const { model, flags, extra } = parseCpuProperty(String(patch.cpu))
    if (allowed && model && model !== (opts.currentModel ?? '') && !allowed.has(model)) {
      const list = [...allowed].sort().join(', ') || 'none'
      return { ok: false, error: `CPU model "${model}" is not allowed by the vDC compute policy. Allowed models: ${list}.` }
    }
    if (!policy.cpuAdvancedSettings && (flags.length > 0 || Object.keys(extra).length > 0)) {
      return { ok: false, error: 'CPU flags and advanced CPU options are disabled by the vDC compute policy.' }
    }
  }

  // Dropping the `cpu` line puts the guest back on PVE's default model, which
  // is a model change like any other.
  if (allowed && removed.includes('cpu') && !allowed.has(PVE_DEFAULT_CPU_MODEL) && (opts.currentModel ?? '') !== PVE_DEFAULT_CPU_MODEL) {
    const list = [...allowed].sort().join(', ') || 'none'
    return { ok: false, error: `Resetting the CPU model to "${PVE_DEFAULT_CPU_MODEL}" is not allowed by the vDC compute policy. Allowed models: ${list}.` }
  }

  if (!policy.cpuAdvancedSettings) {
    for (const key of ADVANCED_KEYS) {
      if (isPresent(patch[key]) || removed.includes(key)) {
        return { ok: false, error: `"${key}" is locked by the vDC compute policy (advanced CPU settings are disabled).` }
      }
    }
  }

  return { ok: true }
}

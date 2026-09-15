import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_COMPUTE_POLICY,
  loadCpuCapabilitiesIfNeeded,
  normalizeComputePolicyInput,
  normalizeCpuModelName,
  parseCpuProperty,
  pickPolicyDefaultModel,
  resolveAllowedCpuModels,
  validateCpuAgainstPolicy,
  type VdcComputePolicy,
} from './computePolicy'

const selected = (models: string[], advanced = true): VdcComputePolicy => ({
  cpuModelMode: 'selected',
  cpuAllowedModels: models,
  cpuDefaultModel: null,
  cpuAdvancedSettings: advanced,
})

const capabilities = [
  { name: 'host' },
  { name: 'kvm64' },
  { name: 'foo', custom: 1 },
  { name: 'custom-bar', custom: 1 },
]

describe('normalizeComputePolicyInput', () => {
  it('returns the default policy for an empty input', () => {
    expect(normalizeComputePolicyInput(null)).toEqual(DEFAULT_COMPUTE_POLICY)
    expect(normalizeComputePolicyInput(undefined)).toEqual(DEFAULT_COMPUTE_POLICY)
  })

  it('falls back to unrestricted on an unknown mode', () => {
    expect(normalizeComputePolicyInput({ cpuModelMode: 'whatever' as any }).cpuModelMode).toBe('unrestricted')
  })

  it('keeps the list in selected mode and drops junk model names', () => {
    const out = normalizeComputePolicyInput({
      cpuModelMode: 'selected',
      cpuAllowedModels: ['x86-64-v2-AES', ' custom-gold ', 'bad name', 'x86-64-v2-AES', 'evil;rm -rf'],
    })
    expect(out.cpuAllowedModels).toEqual(['x86-64-v2-AES', 'custom-gold'])
  })

  it('empties the list outside selected mode', () => {
    expect(normalizeComputePolicyInput({ cpuModelMode: 'custom', cpuAllowedModels: ['host'] }).cpuAllowedModels).toEqual([])
    expect(normalizeComputePolicyInput({ cpuModelMode: 'unrestricted', cpuAllowedModels: ['host'] }).cpuAllowedModels).toEqual([])
  })

  it('normalizes the default model and the advanced switch', () => {
    const out = normalizeComputePolicyInput({ cpuDefaultModel: ' host ', cpuAdvancedSettings: false })
    expect(out.cpuDefaultModel).toBe('host')
    expect(out.cpuAdvancedSettings).toBe(false)
    expect(normalizeComputePolicyInput({ cpuDefaultModel: 'not valid' }).cpuDefaultModel).toBeNull()
    expect(normalizeComputePolicyInput({ cpuAdvancedSettings: 'no' as any }).cpuAdvancedSettings).toBe(true)
  })
})

describe('parseCpuProperty', () => {
  it('reads a bare model', () => {
    expect(parseCpuProperty('host')).toEqual({ model: 'host', flags: [], extra: {} })
  })

  it('splits flags off the model', () => {
    expect(parseCpuProperty('host,flags=+aes;-pcid')).toEqual({ model: 'host', flags: ['+aes', '-pcid'], extra: {} })
  })

  it('honours the explicit cputype key and keeps other options', () => {
    expect(parseCpuProperty('cputype=x86-64-v2-AES,hidden=1')).toEqual({
      model: 'x86-64-v2-AES',
      flags: [],
      extra: { hidden: '1' },
    })
  })

  it('tolerates an empty value', () => {
    expect(parseCpuProperty('')).toEqual({ model: '', flags: [], extra: {} })
  })
})

describe('normalizeCpuModelName', () => {
  it('prefixes custom entries and leaves built-ins alone', () => {
    expect(normalizeCpuModelName({ name: 'host' })).toBe('host')
    expect(normalizeCpuModelName({ name: 'foo', custom: 1 })).toBe('custom-foo')
    expect(normalizeCpuModelName({ name: 'custom-bar', custom: 1 })).toBe('custom-bar')
    expect(normalizeCpuModelName({ name: 'custom-baz' })).toBe('custom-baz')
    expect(normalizeCpuModelName({})).toBeNull()
    expect(normalizeCpuModelName(null)).toBeNull()
  })
})

describe('resolveAllowedCpuModels', () => {
  it('is null when unrestricted', () => {
    expect(resolveAllowedCpuModels(DEFAULT_COMPUTE_POLICY, capabilities)).toBeNull()
  })

  it('keeps only the cluster custom models in custom mode', () => {
    const allowed = resolveAllowedCpuModels({ ...DEFAULT_COMPUTE_POLICY, cpuModelMode: 'custom' }, capabilities)
    expect([...allowed!].sort()).toEqual(['custom-bar', 'custom-foo'])
  })

  it('is empty in custom mode without capabilities', () => {
    expect(resolveAllowedCpuModels({ ...DEFAULT_COMPUTE_POLICY, cpuModelMode: 'custom' }, undefined)?.size).toBe(0)
  })

  it('returns the explicit list in selected mode', () => {
    expect([...resolveAllowedCpuModels(selected(['host', 'kvm64']))!]).toEqual(['host', 'kvm64'])
  })
})

describe('validateCpuAgainstPolicy', () => {
  it('passes everything when the policy is missing or unrestricted', () => {
    expect(validateCpuAgainstPolicy(null, { cpu: 'host', numa: 1, cpulimit: 4 })).toEqual({ ok: true })
    expect(validateCpuAgainstPolicy(DEFAULT_COMPUTE_POLICY, { cpu: 'host,flags=+aes', numa: 1 })).toEqual({ ok: true })
  })

  it('rejects a model outside the selected set and names the allowed ones', () => {
    const verdict = validateCpuAgainstPolicy(selected(['x86-64-v2-AES', 'custom-gold']), { cpu: 'host' })
    expect(verdict.ok).toBe(false)
    if (verdict.ok === false) {
      expect(verdict.error).toContain('"host"')
      expect(verdict.error).toContain('custom-gold, x86-64-v2-AES')
    }
  })

  it('accepts a model inside the selected set', () => {
    expect(validateCpuAgainstPolicy(selected(['x86-64-v2-AES']), { cpu: 'x86-64-v2-AES' })).toEqual({ ok: true })
  })

  it('accepts keeping the current model even when it sits outside the set', () => {
    expect(validateCpuAgainstPolicy(selected(['x86-64-v2-AES']), { cpu: 'host' }, { currentModel: 'host' })).toEqual({ ok: true })
    expect(validateCpuAgainstPolicy(selected(['x86-64-v2-AES']), { cpu: 'kvm64' }, { currentModel: 'host' }).ok).toBe(false)
  })

  it('judges custom mode against the cluster capabilities', () => {
    const policy: VdcComputePolicy = { ...DEFAULT_COMPUTE_POLICY, cpuModelMode: 'custom' }
    expect(validateCpuAgainstPolicy(policy, { cpu: 'custom-foo' }, { clusterCapabilities: capabilities })).toEqual({ ok: true })
    expect(validateCpuAgainstPolicy(policy, { cpu: 'host' }, { clusterCapabilities: capabilities }).ok).toBe(false)
    expect(validateCpuAgainstPolicy(policy, { cpu: 'custom-foo' }).ok).toBe(false)
  })

  it('ignores a patch that leaves the CPU alone', () => {
    expect(validateCpuAgainstPolicy(selected(['x86-64-v2-AES'], false), { memory: 2048 } as any)).toEqual({ ok: true })
  })

  describe('advanced settings off', () => {
    const policy = selected(['x86-64-v2-AES'], false)

    it('rejects flags, NUMA, a CPU limit and non-default units', () => {
      expect(validateCpuAgainstPolicy(policy, { cpu: 'x86-64-v2-AES,flags=+aes' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { cpu: 'x86-64-v2-AES,hidden=1' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { numa: 1 }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { numa: '1' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { cpulimit: 2 }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { cpuunits: 2048 }).ok).toBe(false)
    })

    it('refuses even neutral values: a cpulimit=0 would lift a cap the provider set', () => {
      expect(validateCpuAgainstPolicy(policy, { numa: 0 }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { cpulimit: 0 }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { cpuunits: 1024 }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { cpu: 'x86-64-v2-AES' })).toEqual({ ok: true })
    })

    it('refuses removing a locked key through delete or revert', () => {
      expect(validateCpuAgainstPolicy(policy, { delete: 'cpulimit' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { revert: 'numa,cores' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(policy, { delete: 'cores' })).toEqual({ ok: true })
    })

    it('treats deleting the cpu line as a change to kvm64', () => {
      expect(validateCpuAgainstPolicy(policy, { delete: 'cpu' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(selected(['kvm64']), { delete: 'cpu' })).toEqual({ ok: true })
      expect(validateCpuAgainstPolicy(policy, { delete: 'cpu' }, { currentModel: 'kvm64' })).toEqual({ ok: true })
    })

    it('still enforces the advanced part while unrestricted on models', () => {
      const advancedOff: VdcComputePolicy = { ...DEFAULT_COMPUTE_POLICY, cpuAdvancedSettings: false }
      expect(validateCpuAgainstPolicy(advancedOff, { cpu: 'host' })).toEqual({ ok: true })
      expect(validateCpuAgainstPolicy(advancedOff, { cpu: 'host,flags=+aes' }).ok).toBe(false)
      expect(validateCpuAgainstPolicy(advancedOff, { numa: 1 }).ok).toBe(false)
    })
  })
})

describe('pickPolicyDefaultModel', () => {
  it('keeps the caller value under an unrestricted model policy', () => {
    expect(pickPolicyDefaultModel(DEFAULT_COMPUTE_POLICY)).toBeUndefined()
    expect(pickPolicyDefaultModel({ ...DEFAULT_COMPUTE_POLICY, cpuAdvancedSettings: false })).toBeUndefined()
  })

  it('prefers the vDC default when it is allowed, else the first allowed model', () => {
    expect(pickPolicyDefaultModel({ ...selected(['x86-64-v3', 'x86-64-v2-AES']), cpuDefaultModel: 'x86-64-v3' })).toBe('x86-64-v3')
    expect(pickPolicyDefaultModel({ ...selected(['x86-64-v3', 'x86-64-v2-AES']), cpuDefaultModel: 'host' })).toBe('x86-64-v2-AES')
    expect(pickPolicyDefaultModel(selected(['x86-64-v3', 'x86-64-v2-AES']))).toBe('x86-64-v2-AES')
  })

  it('returns null when nothing is allowed', () => {
    expect(pickPolicyDefaultModel(selected([]))).toBeNull()
    expect(pickPolicyDefaultModel({ ...DEFAULT_COMPUTE_POLICY, cpuModelMode: 'custom' }, [{ name: 'host' }])).toBeNull()
  })
})

describe('loadCpuCapabilitiesIfNeeded', () => {
  it('only fetches in custom mode with a cpu in the patch', async () => {
    const fetcher = vi.fn(async () => capabilities)
    await expect(loadCpuCapabilitiesIfNeeded(DEFAULT_COMPUTE_POLICY, { cpu: 'host' }, fetcher)).resolves.toBeUndefined()
    await expect(loadCpuCapabilitiesIfNeeded(selected(['host']), { cpu: 'host' }, fetcher)).resolves.toBeUndefined()
    const custom: VdcComputePolicy = { ...DEFAULT_COMPUTE_POLICY, cpuModelMode: 'custom' }
    await expect(loadCpuCapabilitiesIfNeeded(custom, {}, fetcher)).resolves.toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
    await expect(loadCpuCapabilitiesIfNeeded(custom, { cpu: 'custom-foo' }, fetcher)).resolves.toBe(capabilities)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the fetch throws', async () => {
    const custom: VdcComputePolicy = { ...DEFAULT_COMPUTE_POLICY, cpuModelMode: 'custom' }
    const caps = await loadCpuCapabilitiesIfNeeded(custom, { cpu: 'custom-foo' }, async () => { throw new Error('boom') })
    expect(caps).toBeUndefined()
    expect(validateCpuAgainstPolicy(custom, { cpu: 'custom-foo' }, { clusterCapabilities: caps }).ok).toBe(false)
  })
})

describe('parseCpuProperty', () => {
  it('keeps the model, the flags and the extra properties of a PVE cpu string', () => {
    expect(parseCpuProperty('host,flags=+aes;-pcid,hidden=1')).toEqual({ model: 'host', flags: ['+aes', '-pcid'], extra: { hidden: '1' } })
    expect(parseCpuProperty('cputype=x86-64-v2-AES,hv-vendor-id=proxmox')).toEqual({ model: 'x86-64-v2-AES', flags: [], extra: { 'hv-vendor-id': 'proxmox' } })
  })

  it('drops keys that are not PVE property names, so a user string cannot reach the prototype', () => {
    const parsed = parseCpuProperty('host,__proto__=polluted,constructor=x,pro to=1,1bad=2,hidden=1')
    expect(parsed.extra).toEqual({ hidden: '1' })
    expect(Object.keys(parsed.extra)).toEqual(['hidden'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(parsed.extra)).toBe(Object.prototype)
  })
})

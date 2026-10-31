import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { DEFAULT_ASSUMPTIONS, type PlanningAssumptions } from '../algorithms/capacityPlanning'
import { PLANNING_ASSUMPTIONS_STORAGE_KEY, parseAssumptions, usePlanningAssumptions } from './usePlanningAssumptions'

const saved: PlanningAssumptions = { template: { vcpu: 8, ramGiB: 32 }, maxVcpuRatio: 2.5 }

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('parseAssumptions', () => {
  it('returns null for a missing or unreadable value', () => {
    expect(parseAssumptions(null)).toBeNull()
    expect(parseAssumptions('')).toBeNull()
    expect(parseAssumptions('{not json')).toBeNull()
    expect(parseAssumptions('null')).toBeNull()
  })

  it('keeps only the known fields of a valid value', () => {
    const raw = JSON.stringify({ template: { vcpu: 2, ramGiB: 4, extra: true }, maxVcpuRatio: 3, other: 'x' })

    expect(parseAssumptions(raw)).toEqual({ template: { vcpu: 2, ramGiB: 4 }, maxVcpuRatio: 3 })
  })

  it.each([
    ['a zero vCPU', { template: { vcpu: 0, ramGiB: 4 }, maxVcpuRatio: 3 }],
    ['too many vCPU', { template: { vcpu: 513, ramGiB: 4 }, maxVcpuRatio: 3 }],
    ['a negative RAM', { template: { vcpu: 2, ramGiB: -1 }, maxVcpuRatio: 3 }],
    ['too much RAM', { template: { vcpu: 2, ramGiB: 8193 }, maxVcpuRatio: 3 }],
    ['a ratio above 64', { template: { vcpu: 2, ramGiB: 4 }, maxVcpuRatio: 65 }],
    ['a text vCPU', { template: { vcpu: '2', ramGiB: 4 }, maxVcpuRatio: 3 }],
    ['no template', { maxVcpuRatio: 3 }],
  ])('rejects %s', (_label, value) => {
    expect(parseAssumptions(JSON.stringify(value))).toBeNull()
  })

  it('accepts the upper bounds', () => {
    const raw = JSON.stringify({ template: { vcpu: 512, ramGiB: 8192 }, maxVcpuRatio: 64 })

    expect(parseAssumptions(raw)).toEqual({ template: { vcpu: 512, ramGiB: 8192 }, maxVcpuRatio: 64 })
  })
})

describe('usePlanningAssumptions', () => {
  it('starts on the defaults when nothing is saved', () => {
    const { result } = renderHook(() => usePlanningAssumptions())

    expect(result.current[0]).toEqual(DEFAULT_ASSUMPTIONS)
  })

  it('restores the assumptions saved in the browser', () => {
    localStorage.setItem(PLANNING_ASSUMPTIONS_STORAGE_KEY, JSON.stringify(saved))

    const { result } = renderHook(() => usePlanningAssumptions())

    expect(result.current[0]).toEqual(saved)
  })

  it('ignores an invalid saved value', () => {
    localStorage.setItem(PLANNING_ASSUMPTIONS_STORAGE_KEY, JSON.stringify({ template: { vcpu: 0, ramGiB: 4 }, maxVcpuRatio: 4 }))

    const { result } = renderHook(() => usePlanningAssumptions())

    expect(result.current[0]).toEqual(DEFAULT_ASSUMPTIONS)
  })

  it('applies and saves a new choice', () => {
    const { result } = renderHook(() => usePlanningAssumptions())

    act(() => { result.current[1](saved) })

    expect(result.current[0]).toEqual(saved)
    expect(JSON.parse(localStorage.getItem(PLANNING_ASSUMPTIONS_STORAGE_KEY) ?? 'null')).toEqual(saved)
  })

  it('keeps the defaults and still applies a choice when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    const { result } = renderHook(() => usePlanningAssumptions())
    expect(result.current[0]).toEqual(DEFAULT_ASSUMPTIONS)

    act(() => { result.current[1](saved) })

    expect(setItem).toHaveBeenCalledWith(PLANNING_ASSUMPTIONS_STORAGE_KEY, JSON.stringify(saved))
    expect(result.current[0]).toEqual(saved)
  })
})

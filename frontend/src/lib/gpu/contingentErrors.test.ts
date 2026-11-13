import { describe, expect, it } from 'vitest'

import en from '@/messages/en.json'

import { gpuContingentMessage } from './contingentErrors'

const t = (key: string, values: Record<string, string | number> = {}) => {
  const text = key.split('.').reduce<any>((node, part) => node?.[part], en)
  return typeof text === 'string' ? text.replace(/\{(\w+)\}/g, (_, k) => String(values[k] ?? '')) : key
}

describe('gpuContingentMessage', () => {
  it('reads the three contingent codes of a route body, with the use of a full line', () => {
    expect(gpuContingentMessage(t, { error: 'gpu_via_my_vdc' })).toBe(en.hardware.gpuContingent.gpu_via_my_vdc)
    expect(gpuContingentMessage(t, { error: 'quota_exhausted', used: 2, count: 2 })).toBe('Your GPU contingent has no room for this (2 of 2 used).')
    expect(gpuContingentMessage(t, { error: 'gpu_check_unavailable' })).toBe(en.hardware.gpuContingent.gpu_check_unavailable)
  })

  it('reads the code an Error carries', () => {
    expect(gpuContingentMessage(t, new Error('gpu_via_my_vdc'))).toBe(en.hardware.gpuContingent.gpu_via_my_vdc)
  })

  it('null for any other error', () => {
    expect(gpuContingentMessage(t, { error: 'Quota exceeded' })).toBeNull()
    expect(gpuContingentMessage(t, new Error('PVE 500'))).toBeNull()
    expect(gpuContingentMessage(t, null)).toBeNull()
    expect(gpuContingentMessage(t, 'gpu_via_my_vdc')).toBeNull()
  })
})

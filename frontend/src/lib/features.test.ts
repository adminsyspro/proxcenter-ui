import { describe, it, expect } from 'vitest'
import { isMultiLicenseEnabled } from './features'

describe('isMultiLicenseEnabled', () => {
  it('is enabled when GET /license/imports returns 200', () => {
    expect(isMultiLicenseEnabled(200)).toBe(true)
  })
  it('is disabled when the import route is not registered (404)', () => {
    expect(isMultiLicenseEnabled(404)).toBe(false)
  })
  it('is disabled when the orchestrator is unavailable (503)', () => {
    expect(isMultiLicenseEnabled(503)).toBe(false)
  })
  it('is disabled on any other status', () => {
    expect(isMultiLicenseEnabled(500)).toBe(false)
    expect(isMultiLicenseEnabled(0)).toBe(false)
  })
})

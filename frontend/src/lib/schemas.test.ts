import { describe, it, expect } from 'vitest'
import { deploySchema } from './schemas'

// vmName follows Proxmox DNS-hostname rules (RFC 1123): a label may start
// with a digit. Regression guard for #522 — names like "2604-kdcs-002" were
// rejected with "Invalid VM name" because the regex forced a leading letter.
describe('deploySchema vmName', () => {
  const vmName = deploySchema.shape.vmName

  it('accepts a name starting with a digit (#522)', () => {
    expect(vmName.safeParse('2604-kdcs-002').success).toBe(true)
  })

  it('accepts a name starting with a letter', () => {
    expect(vmName.safeParse('web-server-01').success).toBe(true)
  })

  it('accepts dots and underscores', () => {
    expect(vmName.safeParse('db1.prod_east').success).toBe(true)
  })

  it('is optional', () => {
    expect(vmName.safeParse(undefined).success).toBe(true)
  })

  it('rejects names with spaces or illegal characters', () => {
    expect(vmName.safeParse('my vm').success).toBe(false)
    expect(vmName.safeParse('vm@host').success).toBe(false)
  })

  it('rejects names longer than 63 characters', () => {
    expect(vmName.safeParse('a'.repeat(64)).success).toBe(false)
  })
})

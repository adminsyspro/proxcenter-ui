import { describe, it, expect } from 'vitest'

import { hashPassword, verifyPassword, generateRandomPassword } from './password'

describe('hashPassword', () => {
  it('returns salt:hash format', async () => {
    const hash = await hashPassword('mypassword')
    const parts = hash.split(':')

    expect(parts).toHaveLength(2)
    expect(parts[0].length).toBeGreaterThan(0) // salt
    expect(parts[1].length).toBeGreaterThan(0) // hash
  })

  it('produces different salts for the same password', async () => {
    const hash1 = await hashPassword('same')
    const hash2 = await hashPassword('same')
    const salt1 = hash1.split(':')[0]
    const salt2 = hash2.split(':')[0]

    expect(salt1).not.toBe(salt2)
  })

  it('produces hex-encoded salt (64 chars = 32 bytes)', async () => {
    const hash = await hashPassword('test')
    const salt = hash.split(':')[0]

    expect(salt).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces hex-encoded hash (128 chars = 64 bytes)', async () => {
    const hash = await hashPassword('test')
    const derivedKey = hash.split(':')[1]

    expect(derivedKey).toMatch(/^[0-9a-f]{128}$/)
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('correctpassword')
    const result = await verifyPassword('correctpassword', hash)

    expect(result).toBe(true)
  })

  it('returns false for incorrect password', async () => {
    const hash = await hashPassword('correctpassword')
    const result = await verifyPassword('wrongpassword', hash)

    expect(result).toBe(false)
  })

  it('returns false for invalid hash format (no colon)', async () => {
    const result = await verifyPassword('test', 'invalidhash')

    expect(result).toBe(false)
  })

  it('returns false for empty hash', async () => {
    const result = await verifyPassword('test', '')

    expect(result).toBe(false)
  })
})

describe('generateRandomPassword', () => {
  it('generates password of default length (16)', () => {
    const password = generateRandomPassword()

    expect(password).toHaveLength(16)
  })

  it('generates password of specified length', () => {
    expect(generateRandomPassword(8)).toHaveLength(8)
    expect(generateRandomPassword(32)).toHaveLength(32)
    expect(generateRandomPassword(1)).toHaveLength(1)
  })

  it('generates different passwords each time', () => {
    const a = generateRandomPassword()
    const b = generateRandomPassword()

    expect(a).not.toBe(b)
  })

  it('uses only allowed characters', () => {
    const allowed = /^[a-zA-Z0-9!@#$%^&*]+$/

    for (let i = 0; i < 10; i++) {
      expect(generateRandomPassword(64)).toMatch(allowed)
    }
  })
})

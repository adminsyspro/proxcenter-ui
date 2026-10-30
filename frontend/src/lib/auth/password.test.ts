import crypto from 'crypto'

import { describe, it, expect, vi } from 'vitest'

import { hashPassword, verifyPassword, needsRehash, burnPasswordCheck, generateRandomPassword } from './password'

// Same parameters as the PBKDF2 format that predates argon2id.
function legacyHash(password: string, salt = 'a'.repeat(64)): string {
  return `${salt}:${crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')}`
}

describe('hashPassword', () => {
  it('returns an argon2id PHC string with the current parameters', async () => {
    const hash = await hashPassword('mypassword')
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/)
  })

  it('produces different salts for the same password', async () => {
    const hash1 = await hashPassword('same')
    const hash2 = await hashPassword('same')
    expect(hash1.split('$')[4]).not.toBe(hash2.split('$')[4])
  })
})

describe('verifyPassword', () => {
  it('returns true for correct password', async () => {
    const hash = await hashPassword('correctpassword')
    expect(await verifyPassword('correctpassword', hash)).toBe(true)
  })

  it('returns false for incorrect password', async () => {
    const hash = await hashPassword('correctpassword')
    expect(await verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('verifies a legacy PBKDF2 hash', async () => {
    const hash = legacyHash('oldpassword')
    expect(await verifyPassword('oldpassword', hash)).toBe(true)
    expect(await verifyPassword('wrongpassword', hash)).toBe(false)
  })

  it('verifies an argon2id hash made with other parameters', async () => {
    const salt = crypto.randomBytes(16)
    const tag = crypto.argon2Sync('argon2id', { message: 'pw', nonce: salt, memory: 8192, passes: 3, parallelism: 2, tagLength: 16 })
    const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '')
    const hash = `$argon2id$v=19$m=8192,t=3,p=2$${b64(salt)}$${b64(tag)}`
    expect(await verifyPassword('pw', hash)).toBe(true)
    expect(await verifyPassword('nope', hash)).toBe(false)
  })

  it('returns false for invalid hash format (no colon)', async () => {
    expect(await verifyPassword('test', 'invalidhash')).toBe(false)
  })

  it('returns false for empty hash', async () => {
    expect(await verifyPassword('test', '')).toBe(false)
  })

  it.each([
    ['unknown version', '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$dGFndGFndGFn'],
    ['memory above the cap', '$argon2id$v=19$m=4194304,t=2,p=1$c2FsdHNhbHRzYWx0$dGFndGFndGFn'],
    ['zero passes', '$argon2id$v=19$m=19456,t=0,p=1$c2FsdHNhbHRzYWx0$dGFndGFndGFn'],
    ['short salt', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$dGFndGFndGFn'],
    ['truncated', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0'],
  ])('rejects a malformed argon2id hash (%s) without deriving', async (_label, hash) => {
    const spy = vi.spyOn(crypto, 'argon2')
    expect(await verifyPassword('test', hash)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('needsRehash', () => {
  it('is false for a hash made with the current parameters', async () => {
    expect(needsRehash(await hashPassword('x'))).toBe(false)
  })

  it('is true for a legacy PBKDF2 hash', () => {
    expect(needsRehash(legacyHash('x'))).toBe(true)
  })

  it('is true for an argon2id hash with other parameters', () => {
    expect(needsRehash('$argon2id$v=19$m=8192,t=3,p=2$c2FsdHNhbHRzYWx0$dGFndGFndGFndGFndGFn')).toBe(true)
  })

  it('is true for an unparseable value', () => {
    expect(needsRehash('')).toBe(true)
  })
})

describe('burnPasswordCheck', () => {
  it('runs one argon2id derivation per call and resolves', async () => {
    await burnPasswordCheck('warmup')
    const spy = vi.spyOn(crypto, 'argon2')
    await expect(burnPasswordCheck('anything')).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
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

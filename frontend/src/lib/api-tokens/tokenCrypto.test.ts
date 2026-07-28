import { describe, expect, it, beforeEach } from 'vitest'

import { generateApiToken, extractTokenPrefix, hashApiToken, verifyTokenHash } from './tokenCrypto'

describe('tokenCrypto', () => {
  beforeEach(() => {
    process.env.APP_SECRET = 'test-app-secret'
  })

  it('generates pxc_ + 32 random bytes base64url, coherent prefix and hash', () => {
    const { secret, prefix, hash } = generateApiToken()
    expect(secret.startsWith('pxc_')).toBe(true)
    // 32 octets en base64url = 43 caracteres sans padding
    expect(secret.slice(4)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(prefix).toBe('pxc_' + secret.slice(4, 12))
    expect(hash).toBe(hashApiToken(secret))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('two generations never collide', () => {
    expect(generateApiToken().secret).not.toBe(generateApiToken().secret)
  })

  it('extractTokenPrefix rejects non pxc_ and too-short inputs', () => {
    expect(extractTokenPrefix('Bearer x')).toBeNull()
    expect(extractTokenPrefix('pxc_abc')).toBeNull()
    expect(extractTokenPrefix('pxc_abcdefgh')).toBe('pxc_abcdefgh')
  })

  it('verifyTokenHash accepts the right secret, rejects a wrong one and a wrong-length hash', () => {
    const { secret, hash } = generateApiToken()
    expect(verifyTokenHash(secret, hash)).toBe(true)
    expect(verifyTokenHash(secret + 'x', hash)).toBe(false)
    expect(verifyTokenHash(secret, 'short')).toBe(false)
  })

  it('hashApiToken is peppered by APP_SECRET', () => {
    const { secret, hash } = generateApiToken()
    process.env.APP_SECRET = 'another-pepper'
    expect(hashApiToken(secret)).not.toBe(hash)
  })

  it('throws when APP_SECRET is unset (fail-closed)', () => {
    delete process.env.APP_SECRET
    expect(() => hashApiToken('pxc_x')).toThrow(/APP_SECRET/)
  })
})

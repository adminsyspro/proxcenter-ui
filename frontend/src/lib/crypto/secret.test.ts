import { describe, it, expect, beforeAll } from 'vitest'

import { encryptSecret, decryptSecret } from './secret'

beforeAll(() => {
  process.env.APP_SECRET = 'test-secret-key-for-unit-tests'
})

describe('encryptSecret / decryptSecret', () => {
  it('round-trip: decrypt(encrypt(plain)) === plain', () => {
    const plain = 'hello world'
    const encrypted = encryptSecret(plain)

    expect(decryptSecret(encrypted)).toBe(plain)
  })

  it('produces iv.tag.data format (3 base64 parts)', () => {
    const encrypted = encryptSecret('test')
    const parts = encrypted.split('.')

    expect(parts).toHaveLength(3)


    // Each part should be valid base64
    for (const part of parts) {
      expect(Buffer.from(part, 'base64').toString('base64')).toBe(part)
    }
  })

  it('generates a random IV each time (different ciphertexts)', () => {
    const a = encryptSecret('same')
    const b = encryptSecret('same')

    expect(a).not.toBe(b)
  })

  it('handles unicode content', () => {
    const plain = 'Bonjour le monde! 🌍 àéîöü'
    const encrypted = encryptSecret(plain)

    expect(decryptSecret(encrypted)).toBe(plain)
  })

  it('handles empty string (empty data part fails validation)', () => {
    // AES-GCM on empty string produces empty ciphertext → base64 is '' → triggers "Invalid secret payload"
    expect(() => {
      const encrypted = encryptSecret('')

      decryptSecret(encrypted)
    }).toThrow('Invalid secret payload')
  })

  it('handles long content', () => {
    const plain = 'x'.repeat(10000)
    const encrypted = encryptSecret(plain)

    expect(decryptSecret(encrypted)).toBe(plain)
  })

  it('throws on invalid payload (missing parts)', () => {
    expect(() => decryptSecret('onlyonepart')).toThrow('Invalid secret payload')
  })

  it('throws on invalid payload (two parts)', () => {
    expect(() => decryptSecret('part1.part2')).toThrow('Invalid secret payload')
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encryptSecret('secret data')
    const parts = encrypted.split('.')


    // Tamper with the data part
    parts[2] = Buffer.from('tampered').toString('base64')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })

  it('throws on tampered auth tag', () => {
    const encrypted = encryptSecret('secret data')
    const parts = encrypted.split('.')


    // Tamper with the tag
    parts[1] = Buffer.from('0000000000000000').toString('base64')
    expect(() => decryptSecret(parts.join('.'))).toThrow()
  })
})

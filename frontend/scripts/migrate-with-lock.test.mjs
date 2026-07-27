import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { pgDsn, LOCK_ID } = require('./migrate-with-lock.js')

describe('migrate-with-lock', () => {
  describe('pgDsn', () => {
    it('strips connection_limit and pool_timeout', () => {
      const url = 'postgresql://user:pass@host:5432/db?schema=public&connection_limit=5&pool_timeout=10'
      expect(pgDsn(url)).toBe('postgresql://user:pass@host:5432/db?schema=public')
    })

    it('preserves other query params', () => {
      const url = 'postgresql://user:pass@host:5432/db?schema=public&sslmode=require'
      expect(pgDsn(url)).toBe('postgresql://user:pass@host:5432/db?schema=public&sslmode=require')
    })

    it('handles URL without Prisma params', () => {
      const url = 'postgresql://user:pass@host:5432/db?schema=public'
      expect(pgDsn(url)).toBe('postgresql://user:pass@host:5432/db?schema=public')
    })

    it('handles URL with no query params', () => {
      const url = 'postgresql://user:pass@host:5432/db'
      expect(pgDsn(url)).toBe('postgresql://user:pass@host:5432/db')
    })
  })

  describe('LOCK_ID', () => {
    it('is the PRMI constant', () => {
      expect(LOCK_ID).toBe(0x50524D49)
    })
  })
})

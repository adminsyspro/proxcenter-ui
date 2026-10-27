import { describe, it, expect } from 'vitest'
import { ensurePrefix, withoutPrefix, withoutSuffix } from './string'

describe('ensurePrefix', () => {
  it('adds prefix when missing', () => {
    expect(ensurePrefix('world', 'hello ')).toBe('hello world')
  })

  it('does not duplicate prefix when present', () => {
    expect(ensurePrefix('/path', '/')).toBe('/path')
  })

  it('handles empty string', () => {
    expect(ensurePrefix('', '/')).toBe('/')
  })

  it('handles empty prefix', () => {
    expect(ensurePrefix('test', '')).toBe('test')
  })

  it('works with multi-char prefix', () => {
    expect(ensurePrefix('example.com', 'https://')).toBe('https://example.com')
    expect(ensurePrefix('https://example.com', 'https://')).toBe('https://example.com')
  })
})

describe('withoutPrefix', () => {
  it('removes prefix when present', () => {
    expect(withoutPrefix('/path', '/')).toBe('path')
  })

  it('returns unchanged when prefix not present', () => {
    expect(withoutPrefix('path', '/')).toBe('path')
  })

  it('handles empty string', () => {
    expect(withoutPrefix('', '/')).toBe('')
  })

  it('handles empty prefix', () => {
    expect(withoutPrefix('test', '')).toBe('test')
  })

  it('removes only first occurrence of prefix', () => {
    expect(withoutPrefix('//path', '/')).toBe('/path')
  })

  it('works with multi-char prefix', () => {
    expect(withoutPrefix('https://example.com', 'https://')).toBe('example.com')
  })
})

describe('withoutSuffix', () => {
  it('removes suffix when present', () => {
    expect(withoutSuffix('file.txt', '.txt')).toBe('file')
  })

  it('returns unchanged when suffix not present', () => {
    expect(withoutSuffix('file.txt', '.md')).toBe('file.txt')
  })

  it('handles empty string', () => {
    expect(withoutSuffix('', '.txt')).toBe('')
  })

  it('handles empty suffix (returns empty due to slice(0, -0))', () => {
    // str.slice(0, -suffix.length) when suffix is '' → slice(0, -0) → slice(0, 0) → ''
    expect(withoutSuffix('test', '')).toBe('')
  })

  it('removes only the suffix at the end', () => {
    expect(withoutSuffix('path/to/file/', '/')).toBe('path/to/file')
  })

  it('works with multi-char suffix', () => {
    expect(withoutSuffix('index.test.ts', '.test.ts')).toBe('index')
  })
})

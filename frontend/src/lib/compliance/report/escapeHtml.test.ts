import { describe, it, expect } from 'vitest'
import { escapeHtml, sanitizeFilename } from './escapeHtml'
describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<img src=x onerror=1>&"\'')).toBe('&lt;img src=x onerror=1&gt;&amp;&quot;&#39;')
  })
})
describe('sanitizeFilename', () => {
  it('strips path separators and control chars', () => {
    expect(sanitizeFilename('../a/b"c .pdf')).toBe('a-b-c.pdf')
  })
  it('trims edge dashes and collapses dash runs', () => {
    expect(sanitizeFilename('---a---b---')).toBe('a-b')
    expect(sanitizeFilename('/<CIS>/ 2026/')).toBe('CIS-2026')
    expect(sanitizeFilename('-')).toBe('')
  })
})

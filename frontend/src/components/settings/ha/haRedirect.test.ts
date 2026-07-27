import { describe, it, expect } from 'vitest'

import { resolveCompletionTarget } from './haRedirect'

describe('resolveCompletionTarget', () => {
  it('targets the VIP when no external URL was preserved', () => {
    expect(resolveCompletionTarget('', '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
    expect(resolveCompletionTarget(undefined, '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
  })

  it('targets the preserved external URL when present', () => {
    expect(resolveCompletionTarget('https://proxcenter.example.com', '192.0.2.100')).toEqual({
      url: 'https://proxcenter.example.com',
      external: true,
    })
  })

  it('treats a VIP-hosted external URL as a fresh IP-only install', () => {
    expect(resolveCompletionTarget('http://192.0.2.100:3000', '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
  })

  it('falls back to the VIP on an unparseable external URL', () => {
    expect(resolveCompletionTarget('not a url', '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
  })

  it('falls back to the VIP on a non-http(s) scheme', () => {
    // The target is assigned to window.location, so a script-bearing URL must
    // never survive resolution.
    expect(resolveCompletionTarget('javascript:alert(1)', '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
    expect(resolveCompletionTarget('data:text/html,<script>alert(1)</script>', '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
    expect(resolveCompletionTarget('file:///etc/passwd', '192.0.2.100')).toEqual({
      url: 'http://192.0.2.100:3000',
      external: false,
    })
  })

  it('trims surrounding whitespace', () => {
    expect(resolveCompletionTarget('  https://pcx.example.com  ', '192.0.2.100')).toEqual({
      url: 'https://pcx.example.com',
      external: true,
    })
  })
})

import { describe, it, expect } from 'vitest'

import { resolveCompletionTarget } from './haRedirect'

describe('resolveCompletionTarget', () => {
  it('targets the VIP when no external URL was preserved', () => {
    expect(resolveCompletionTarget('', '10.24.24.100')).toEqual({
      url: 'http://10.24.24.100:3000',
      external: false,
    })
    expect(resolveCompletionTarget(undefined, '10.24.24.100')).toEqual({
      url: 'http://10.24.24.100:3000',
      external: false,
    })
  })

  it('targets the preserved external URL when present', () => {
    expect(resolveCompletionTarget('https://proxcenter.example.com', '10.24.24.100')).toEqual({
      url: 'https://proxcenter.example.com',
      external: true,
    })
  })

  it('treats a VIP-hosted external URL as a fresh IP-only install', () => {
    expect(resolveCompletionTarget('http://10.24.24.100:3000', '10.24.24.100')).toEqual({
      url: 'http://10.24.24.100:3000',
      external: false,
    })
  })

  it('falls back to the VIP on an unparseable external URL', () => {
    expect(resolveCompletionTarget('not a url', '10.24.24.100')).toEqual({
      url: 'http://10.24.24.100:3000',
      external: false,
    })
  })

  it('trims surrounding whitespace', () => {
    expect(resolveCompletionTarget('  https://pcx.example.com  ', '10.24.24.100')).toEqual({
      url: 'https://pcx.example.com',
      external: true,
    })
  })
})

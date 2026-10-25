import { describe, expect, it } from 'vitest'

import { checkPublicUrlCoherence } from '@/lib/tls/urlCoherence'

describe('checkPublicUrlCoherence', () => {
  it('is happy when both public URLs are https', () => {
    expect(checkPublicUrlCoherence({ APP_URL: 'https://pc.lab', NEXTAUTH_URL: 'https://pc.lab' } as any))
      .toEqual({ ok: true, issues: [] })
  })

  it('names APP_URL when it is still http', () => {
    const result = checkPublicUrlCoherence({ APP_URL: 'http://pc.lab', NEXTAUTH_URL: 'https://pc.lab' } as any)

    expect(result.ok).toBe(false)
    expect(result.issues.join(' ')).toContain('APP_URL')
  })

  it('names NEXTAUTH_URL when it is still http', () => {
    const result = checkPublicUrlCoherence({ APP_URL: 'https://pc.lab', NEXTAUTH_URL: 'http://pc.lab' } as any)

    expect(result.issues.join(' ')).toContain('NEXTAUTH_URL')
  })

  it('reports an unset variable rather than silently passing', () => {
    expect(checkPublicUrlCoherence({} as any).ok).toBe(false)
  })

  it('reports a malformed URL instead of throwing', () => {
    expect(() => checkPublicUrlCoherence({ APP_URL: 'nope', NEXTAUTH_URL: 'https://pc.lab' } as any)).not.toThrow()
    expect(checkPublicUrlCoherence({ APP_URL: 'nope', NEXTAUTH_URL: 'https://pc.lab' } as any).ok).toBe(false)
  })
})

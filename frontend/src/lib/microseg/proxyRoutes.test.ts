import { describe, it, expect } from 'vitest'

import { MICROSEG_ROUTES, matchMicrosegRoute } from './proxyRoutes'

describe('matchMicrosegRoute', () => {
  it('matches every orchestrator route and nothing else', () => {
    expect(matchMicrosegRoute('GET', ['policy'])?.write).toBe(false)
    expect(matchMicrosegRoute('POST', ['zones', 'z1', 'state'])?.write).toBe(true)
    expect(matchMicrosegRoute('DELETE', ['policy'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['..', 'drs'])).toBeNull()
  })

  it('knows the exact route table of the orchestrator', () => {
    const table = MICROSEG_ROUTES.map(r => `${r.method} ${r.pattern.source}`).sort()

    expect(MICROSEG_ROUTES).toHaveLength(24)
    expect(table).toHaveLength(new Set(table).size)

    const cases: Array<[string, string[], boolean]> = [
      ['GET', ['policy'], false],
      ['PUT', ['policy'], true],
      ['POST', ['zones'], true],
      ['PUT', ['zones', 'z1'], true],
      ['DELETE', ['zones', 'z1'], true],
      ['POST', ['flows'], true],
      ['PUT', ['flows', 'f1'], true],
      ['DELETE', ['flows', 'f1'], true],
      ['POST', ['members'], true],
      ['POST', ['plan'], true],
      ['POST', ['apply'], true],
      ['POST', ['zones', 'z1', 'state'], true],
      ['GET', ['revisions'], false],
      ['POST', ['revisions', '7', 'restore'], true],
      ['GET', ['suggestions'], false],
      ['POST', ['suggestions', 'resolve'], true],
      ['GET', ['drifts'], false],
      ['GET', ['preflight'], false],
      ['POST', ['confirm-writes'], true],
      ['POST', ['emergency-stop'], true],
      ['POST', ['remove'], true],
      ['GET', ['runs'], false],
      ['GET', ['runs', 'r-1'], false],
      ['GET', ['status'], false],
    ]

    for (const [method, path, write] of cases) {
      const route = matchMicrosegRoute(method, path)

      expect(route, `${method} /${path.join('/')}`).not.toBeNull()
      expect(route?.write, `${method} /${path.join('/')}`).toBe(write)
    }
  })

  it('refuses a verb the orchestrator does not serve on a known path', () => {
    expect(matchMicrosegRoute('POST', ['flows', 'f1'])).toBeNull()
    expect(matchMicrosegRoute('PUT', ['zones'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['apply'])).toBeNull()
    expect(matchMicrosegRoute('DELETE', ['runs', 'r1'])).toBeNull()
    expect(matchMicrosegRoute('PATCH', ['policy'])).toBeNull()
  })

  it('refuses unknown paths, extra segments and unsafe segments', () => {
    expect(matchMicrosegRoute('GET', [])).toBeNull()
    expect(matchMicrosegRoute('GET', ['policy', 'extra'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['analyze'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['runs', 'a/b'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['runs', 'a b'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['runs', '%2e%2e'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['runs', '.'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['runs', ''])).toBeNull()
    expect(matchMicrosegRoute('PUT', ['zones', '../policy'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['status\n'])).toBeNull()
  })

  it('is case sensitive on the verb', () => {
    expect(matchMicrosegRoute('get', ['policy'])).toBeNull()
  })
})

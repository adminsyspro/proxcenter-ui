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

    expect(MICROSEG_ROUTES).toHaveLength(38)
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
      ['POST', ['exceptions'], true],
      ['PUT', ['exceptions', 'e1'], true],
      ['DELETE', ['exceptions', 'e1'], true],
      ['POST', ['members'], true],
      ['POST', ['plan'], true],
      ['POST', ['apply'], true],
      ['POST', ['zones', 'z1', 'state'], true],
      ['POST', ['zones', 'z1', 'egress-state'], true],
      ['GET', ['revisions'], false],
      ['POST', ['revisions', '7', 'restore'], true],
      ['GET', ['suggestions'], false],
      ['POST', ['suggestions', 'resolve'], true],
      ['GET', ['drifts'], false],
      ['GET', ['preflight'], false],
      ['GET', ['ipfilter'], false],
      ['POST', ['confirm-writes'], true],
      ['POST', ['emergency-stop'], true],
      ['POST', ['remove'], true],
      ['POST', ['check'], true],
      ['POST', ['cluster-firewall', 'enable'], true],
      ['GET', ['runs'], false],
      ['GET', ['runs', 'r-1'], false],
      ['GET', ['status'], false],
      ['GET', ['events'], false],
      ['GET', ['traffic'], false],
      ['GET', ['volume'], false],
    ]

    for (const [method, path, write] of cases) {
      const route = matchMicrosegRoute(method, path)

      expect(route, `${method} /${path.join('/')}`).not.toBeNull()
      expect(route?.write, `${method} /${path.join('/')}`).toBe(write)
    }
  })

  it('names who audits each route: the orchestrator its lifecycle actions and the cluster links, the relay every other write, nobody a read', () => {
    const owner = (method: string, path: string[]) => {
      const route = matchMicrosegRoute(method, path)

      return route?.audit === 'none' ? 'none' : `${route?.audit} ${route?.auditAction}`
    }

    expect(owner('POST', ['apply'])).toBe('orchestrator microseg.apply')
    expect(owner('POST', ['zones', 'z1', 'state'])).toBe('orchestrator microseg.state')
    expect(owner('POST', ['zones', 'z1', 'egress-state'])).toBe('orchestrator microseg.egress_state')
    expect(matchMicrosegRoute('POST', ['zones', 'z1', 'egress-state'])?.write).toBe(true)
    expect(matchMicrosegRoute('GET', ['zones', 'z1', 'egress-state'])).toBeNull()
    expect(owner('POST', ['emergency-stop'])).toBe('orchestrator microseg.emergency_stop')
    expect(owner('POST', ['revisions', '7', 'restore'])).toBe('orchestrator microseg.restore')
    expect(owner('POST', ['remove'])).toBe('orchestrator microseg.remove')
    // The orchestrator writes the association and the dissociation rows itself, with the cluster added or removed.
    expect(owner('POST', ['clusters'])).toBe('orchestrator microseg.cluster.associate')
    expect(owner('DELETE', ['clusters', 'abc'])).toBe('orchestrator microseg.cluster.dissociate')

    expect(owner('PUT', ['policy'])).toBe('relay microseg.policy.update')
    // R66: discarding the draft is a draft write, audited by the relay like the others.
    expect(owner('POST', ['policy', 'discard'])).toBe('relay microseg.policy.discard')
    expect(owner('POST', ['zones'])).toBe('relay microseg.zone.create')
    expect(owner('PUT', ['zones', 'z1'])).toBe('relay microseg.zone.update')
    expect(owner('DELETE', ['zones', 'z1'])).toBe('relay microseg.zone.delete')
    expect(owner('POST', ['flows'])).toBe('relay microseg.flow.create')
    expect(owner('PUT', ['flows', 'f1'])).toBe('relay microseg.flow.update')
    expect(owner('DELETE', ['flows', 'f1'])).toBe('relay microseg.flow.delete')
    expect(owner('POST', ['exceptions'])).toBe('relay microseg.exception.create')
    expect(owner('PUT', ['exceptions', 'e1'])).toBe('relay microseg.exception.update')
    expect(owner('DELETE', ['exceptions', 'e1'])).toBe('relay microseg.exception.delete')
    expect(owner('POST', ['members'])).toBe('relay microseg.members.set')
    expect(owner('POST', ['suggestions', 'resolve'])).toBe('relay microseg.suggestions.resolve')
    expect(owner('POST', ['confirm-writes'])).toBe('relay microseg.confirm_writes')
    expect(owner('POST', ['check'])).toBe('relay microseg.check')
    expect(owner('POST', ['cluster-firewall', 'enable'])).toBe('orchestrator microseg.cluster_firewall.enable')

    expect(owner('POST', ['plan'])).toBe('none')
    expect(owner('GET', ['traffic'])).toBe('none')
    expect(owner('GET', ['volume'])).toBe('none')
    for (const route of MICROSEG_ROUTES.filter(r => !r.write)) expect(route.audit).toBe('none')
    expect(MICROSEG_ROUTES.filter(r => r.audit === 'orchestrator')).toHaveLength(9)
  })

  it('refuses a verb the orchestrator does not serve on a known path', () => {
    expect(matchMicrosegRoute('POST', ['flows', 'f1'])).toBeNull()
    // The exceptions are written, never read on their own: they come with GET /policy.
    expect(matchMicrosegRoute('POST', ['exceptions', 'e1'])).toBeNull()
    expect(matchMicrosegRoute('PUT', ['exceptions'])).toBeNull()
    expect(matchMicrosegRoute('DELETE', ['exceptions'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['exceptions'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['exceptions', 'e1'])).toBeNull()
    expect(matchMicrosegRoute('PUT', ['exceptions', 'e1', 'extra'])).toBeNull()
    expect(matchMicrosegRoute('POST', ['exception'])).toBeNull()
    expect(matchMicrosegRoute('PUT', ['zones'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['apply'])).toBeNull()
    expect(matchMicrosegRoute('DELETE', ['runs', 'r1'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['check'])).toBeNull()
    expect(matchMicrosegRoute('POST', ['traffic'])).toBeNull()
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

  it('serves the clusters of a shared policy: list, associate and dissociate, the writes audited by the orchestrator', () => {
    expect(matchMicrosegRoute('GET', ['clusters'])).toMatchObject({ write: false, audit: 'none', scope: 'policy', clustersRead: true })
    expect(MICROSEG_ROUTES.filter(r => r.clustersRead)).toHaveLength(1)
    expect(matchMicrosegRoute('POST', ['clusters'])).toMatchObject({ write: true, audit: 'orchestrator', auditAction: 'microseg.cluster.associate', scope: 'policy' })
    expect(matchMicrosegRoute('DELETE', ['clusters', 'abc'])).toMatchObject({ write: true, audit: 'orchestrator', auditAction: 'microseg.cluster.dissociate', scope: 'policy' })
    // The association is told apart by its own flag, not by its audit action.
    expect(matchMicrosegRoute('POST', ['clusters'])?.associate).toBe(true)
    expect(MICROSEG_ROUTES.filter(r => r.associate)).toHaveLength(1)
    expect(matchMicrosegRoute('DELETE', ['clusters'])).toBeNull()
    expect(matchMicrosegRoute('POST', ['clusters', 'abc'])).toBeNull()
    expect(matchMicrosegRoute('GET', ['clusters', 'abc'])).toBeNull()
    expect(matchMicrosegRoute('DELETE', ['clusters', 'abc', 'extra'])).toBeNull()
  })

  it('gives every route a scope: the URL cluster alone, or every cluster of the policy', () => {
    for (const route of MICROSEG_ROUTES) expect(['policy', 'cluster'], `${route.method} ${route.pattern.source}`).toContain(route.scope)

    const scope = (method: string, path: string[]) => matchMicrosegRoute(method, path)?.scope

    const cluster: Array<[string, string[]]> = [
      ['GET', ['runs']],
      // A run of the URL's cluster: the relay hands back no run of another cluster.
      ['GET', ['runs', 'r-1']],
      ['GET', ['status']],
      ['GET', ['events']],
      ['GET', ['traffic']],
      ['GET', ['volume']],
      ['GET', ['preflight']],
      ['GET', ['ipfilter']],
      ['POST', ['check']],
      ['POST', ['cluster-firewall', 'enable']],
      ['POST', ['confirm-writes']],
      ['POST', ['members']],
      ['POST', ['exceptions']],
      ['PUT', ['exceptions', 'e1']],
      ['DELETE', ['exceptions', 'e1']],
    ]
    const policy: Array<[string, string[]]> = [
      // The drifts name the peer clusters.
      ['GET', ['drifts']],
      ['GET', ['policy']],
      ['PUT', ['policy']],
      ['POST', ['policy', 'discard']],
      ['POST', ['zones']],
      ['PUT', ['zones', 'z1']],
      ['DELETE', ['zones', 'z1']],
      ['POST', ['zones', 'z1', 'state']],
      ['POST', ['zones', 'z1', 'egress-state']],
      ['POST', ['flows']],
      ['PUT', ['flows', 'f1']],
      ['DELETE', ['flows', 'f1']],
      ['POST', ['plan']],
      ['POST', ['apply']],
      ['GET', ['revisions']],
      ['POST', ['revisions', '7', 'restore']],
      ['GET', ['suggestions']],
      ['POST', ['suggestions', 'resolve']],
      ['POST', ['emergency-stop']],
      // On a shared policy the cluster leaves the policy and the other clusters' ipsets are rewritten.
      ['POST', ['remove']],
      ['GET', ['clusters']],
      ['POST', ['clusters']],
      ['DELETE', ['clusters', 'abc']],
    ]

    for (const [method, path] of cluster) expect(scope(method, path), `${method} /${path.join('/')}`).toBe('cluster')
    for (const [method, path] of policy) expect(scope(method, path), `${method} /${path.join('/')}`).toBe('policy')
    expect(matchMicrosegRoute('GET', ['runs', 'r-1'])?.urlClusterRun).toBe(true)
    expect(MICROSEG_ROUTES.filter(r => r.urlClusterRun)).toHaveLength(1)
    expect(cluster.length + policy.length).toBe(MICROSEG_ROUTES.length)
  })
})

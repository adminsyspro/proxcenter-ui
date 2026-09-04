import { describe, expect, it, vi } from 'vitest'

import {
  computeRepoIssues,
  formatRepoError,
  isRepoEnabled,
  isSubscriptionActive,
  loadNodeRepoIssues,
  readRepoErrors,
  readStandardRepos,
} from './aptRepositories'

/**
 * Captured verbatim from `pvesh get /nodes/pve2/apt/repositories` on the PVE 9
 * lab (2026-08-25), after reproducing the exact customer setup: the enterprise
 * repo enabled with no no-subscription counterpart, and two backup files left
 * in /etc/apt/sources.list.d/ under a `.BAK` extension. Only the verbose
 * `description` fields were stripped.
 *
 * The three properties this fixture pins down, each of which the previous code
 * got wrong: the list key is hyphenated, an enabled repo says `status: 1` while
 * a disabled one omits `status`, and errors carry `error`, never `message`.
 */
const LAB_PVE9_PAYLOAD = {
  'standard-repos': [
    { handle: 'enterprise', name: 'Enterprise', status: 1 },
    { handle: 'no-subscription', name: 'No-Subscription' },
    { handle: 'test', name: 'Test' },
    { handle: 'ceph-squid-enterprise', name: 'Ceph Squid Enterprise' },
    { handle: 'ceph-squid-no-subscription', name: 'Ceph Squid No-Subscription', status: 1 },
    { handle: 'ceph-squid-test', name: 'Ceph Squid Test' },
  ],
  errors: [
    { error: 'invalid extension', path: '/etc/apt/sources.list.d/ceph.sources.BAK' },
    { error: 'invalid extension', path: '/etc/apt/sources.list.d/pve-enterprise.sources.BAK' },
  ],
}

describe('readStandardRepos', () => {
  it('reads the hyphenated key PVE actually sends', () => {
    expect(readStandardRepos(LAB_PVE9_PAYLOAD)).toHaveLength(6)
  })

  it('still reads our own normalized snake_case shape', () => {
    expect(readStandardRepos({ standard_repos: [{ handle: 'enterprise' }] })).toHaveLength(1)
  })

  it('returns an empty list rather than throwing on a failed fetch', () => {
    expect(readStandardRepos(undefined)).toEqual([])
    expect(readStandardRepos({})).toEqual([])
    expect(readStandardRepos({ 'standard-repos': 'nope' })).toEqual([])
  })
})

describe('isRepoEnabled', () => {
  // PVE sends the number 1, never the boolean true.
  it('treats the numeric 1 PVE sends as enabled', () => {
    expect(isRepoEnabled(1)).toBe(true)
  })

  it('treats an absent status as disabled, which is how PVE says "off"', () => {
    expect(isRepoEnabled(undefined)).toBe(false)
    expect(isRepoEnabled(null)).toBe(false)
    expect(isRepoEnabled(0)).toBe(false)
  })

  it('accepts a real boolean too, in case PVE ever changes its mind', () => {
    expect(isRepoEnabled(true)).toBe(true)
    expect(isRepoEnabled(false)).toBe(false)
  })
})

describe('formatRepoError', () => {
  it('names the offending file, which is the whole point of the message', () => {
    expect(formatRepoError(LAB_PVE9_PAYLOAD.errors[0])).toBe(
      '/etc/apt/sources.list.d/ceph.sources.BAK: invalid extension'
    )
  })

  it('degrades to the raw object instead of printing undefined', () => {
    expect(formatRepoError({} as any)).toBe('{}')
  })

  it('keeps whichever half PVE gave us', () => {
    expect(formatRepoError({ error: 'invalid extension' })).toBe('invalid extension')
    expect(formatRepoError({ path: '/etc/apt/sources.list.d/x.BAK' })).toBe(
      '/etc/apt/sources.list.d/x.BAK'
    )
  })
})

describe('computeRepoIssues on the real lab payload', () => {
  const issues = computeRepoIssues(LAB_PVE9_PAYLOAD)

  it('reports the enterprise repo enabled without a no-subscription alternative', () => {
    expect(issues.filter(i => i.kind === 'enterprise')).toEqual([{ kind: 'enterprise' }])
  })

  it('does NOT flag ceph, whose no-subscription counterpart is enabled', () => {
    expect(issues.some(i => i.kind === 'enterprise' && i.component === 'Ceph')).toBe(false)
  })

  it('surfaces both unparsable files with their full path', () => {
    expect(issues.filter(i => i.kind === 'parse')).toEqual([
      {
        kind: 'parse',
        detail: '/etc/apt/sources.list.d/ceph.sources.BAK: invalid extension',
      },
      {
        kind: 'parse',
        detail: '/etc/apt/sources.list.d/pve-enterprise.sources.BAK: invalid extension',
      },
    ])
  })

  it('never emits the literal string undefined', () => {
    for (const issue of issues) {
      if (issue.kind === 'parse') expect(issue.detail).not.toContain('undefined')
    }
  })
})

describe('computeRepoIssues', () => {
  it('stays silent on a node using no-subscription only, the customer case', () => {
    // Enterprise files moved away, `pve-no-subscription` in place: nothing to report.
    expect(
      computeRepoIssues({
        'standard-repos': [
          { handle: 'enterprise', name: 'Enterprise' },
          { handle: 'no-subscription', name: 'No-Subscription', status: 1 },
        ],
        errors: [],
      })
    ).toEqual([])
  })

  it('stays silent when both enterprise and no-subscription are enabled', () => {
    expect(
      computeRepoIssues({
        'standard-repos': [
          { handle: 'enterprise', status: 1 },
          { handle: 'no-subscription', status: 1 },
        ],
      })
    ).toEqual([])
  })

  it('flags a ceph enterprise repo left alone without its no-subscription pair', () => {
    expect(
      computeRepoIssues({
        'standard-repos': [
          { handle: 'ceph-squid-enterprise', status: 1 },
          { handle: 'ceph-squid-no-subscription' },
        ],
      })
    ).toEqual([{ kind: 'enterprise', component: 'Ceph' }])
  })

  it('stays silent when a ceph enterprise repo does have its no-subscription pair', () => {
    expect(
      computeRepoIssues({
        'standard-repos': [
          { handle: 'ceph-squid-enterprise', status: 1 },
          { handle: 'ceph-squid-no-subscription', status: 1 },
        ],
      })
    ).toEqual([])
  })

  it('skips a malformed entry with no handle instead of keying on undefined', () => {
    expect(
      computeRepoIssues({
        'standard-repos': [{ name: 'Nameless' }, { handle: '' }, { handle: 'enterprise', status: 1 }],
      })
    ).toEqual([{ kind: 'enterprise' }])
  })

  it('does not mistake the bare enterprise handle for a component pair', () => {
    const issues = computeRepoIssues({ 'standard-repos': [{ handle: 'enterprise', status: 1 }] })

    expect(issues).toEqual([{ kind: 'enterprise' }])
  })

  it('reports parse errors even when the repo list came back empty', () => {
    expect(
      computeRepoIssues({
        'standard-repos': [],
        errors: [{ path: '/etc/apt/sources.list.d/old.list.save', error: 'invalid extension' }],
      })
    ).toEqual([
      {
        kind: 'parse',
        detail: '/etc/apt/sources.list.d/old.list.save: invalid extension',
      },
    ])
  })

  it('reports nothing on an empty or malformed payload', () => {
    expect(computeRepoIssues({})).toEqual([])
    expect(computeRepoIssues(undefined)).toEqual([])
  })
})

describe('readRepoErrors', () => {
  it('reads the errors array', () => {
    expect(readRepoErrors(LAB_PVE9_PAYLOAD)).toHaveLength(2)
  })

  it('tolerates a missing or malformed errors field', () => {
    expect(readRepoErrors({})).toEqual([])
    expect(readRepoErrors({ errors: 'boom' })).toEqual([])
    expect(readRepoErrors(null)).toEqual([])
  })
})

/**
 * The node of issue #853, rebuilt from the customer's screenshots (PVE 9.2.4,
 * 2026-09-03): an active subscription and the production layout Proxmox
 * recommends, PVE enterprise plus Ceph enterprise, no no-subscription
 * repository anywhere. PVE lights BOTH Ceph release handles for their single
 * ceph-squid repository, which is why the dialog listed three problems.
 */
const ISSUE_853_PAYLOAD = {
  'standard-repos': [
    { handle: 'enterprise', name: 'Enterprise', status: 1 },
    { handle: 'no-subscription', name: 'No-Subscription' },
    { handle: 'test', name: 'Test' },
    { handle: 'ceph-squid-enterprise', name: 'Ceph Squid Enterprise', status: 1 },
    { handle: 'ceph-squid-no-subscription', name: 'Ceph Squid No-Subscription' },
    { handle: 'ceph-squid-test', name: 'Ceph Squid Test' },
    { handle: 'ceph-tentacle-enterprise', name: 'Ceph Tentacle Enterprise', status: 1 },
    { handle: 'ceph-tentacle-no-subscription', name: 'Ceph Tentacle No-Subscription' },
    { handle: 'ceph-tentacle-test', name: 'Ceph Tentacle Test' },
  ],
  errors: [],
}

describe('computeRepoIssues with the subscription status, issue #853', () => {
  it('lets a subscribed node keep its enterprise-only repositories', () => {
    expect(computeRepoIssues(ISSUE_853_PAYLOAD, { subscriptionActive: true })).toEqual([])
  })

  it('still blocks the same layout on a node without an active subscription', () => {
    expect(computeRepoIssues(ISSUE_853_PAYLOAD, { subscriptionActive: false })).toEqual([
      { kind: 'enterprise' },
      { kind: 'enterprise', component: 'Ceph' },
    ])
  })

  it('treats an omitted subscription status as not active, the strict side', () => {
    expect(computeRepoIssues(ISSUE_853_PAYLOAD)).toHaveLength(2)
  })

  it('reports Ceph once even though PVE lights every Ceph release handle', () => {
    const ceph = computeRepoIssues(ISSUE_853_PAYLOAD).filter(i => i.kind === 'enterprise' && i.component)

    expect(ceph).toEqual([{ kind: 'enterprise', component: 'Ceph' }])
  })

  it('keeps reporting unreadable files on a subscribed node, apt chokes on them regardless', () => {
    expect(
      computeRepoIssues({ ...ISSUE_853_PAYLOAD, errors: LAB_PVE9_PAYLOAD.errors }, { subscriptionActive: true })
    ).toEqual([
      { kind: 'parse', detail: '/etc/apt/sources.list.d/ceph.sources.BAK: invalid extension' },
      { kind: 'parse', detail: '/etc/apt/sources.list.d/pve-enterprise.sources.BAK: invalid extension' },
    ])
  })
})

/**
 * `pvesh get /nodes/pve1/apt/repositories` on the PVE 9 lab, 2026-09-03: one
 * ceph.sources pointing at ceph-tentacle no-subscription, and PVE marks the
 * squid AND tentacle no-subscription handles as enabled. A configured but
 * disabled repo (pve-enterprise.sources here) carries `status: 0`.
 */
const LAB_PVE9_SINGLE_CEPH_REPO_PAYLOAD = {
  'standard-repos': [
    { handle: 'enterprise', status: 0 },
    { handle: 'no-subscription', status: 1 },
    { handle: 'test' },
    { handle: 'ceph-squid-enterprise' },
    { handle: 'ceph-squid-no-subscription', status: 1 },
    { handle: 'ceph-squid-test' },
    { handle: 'ceph-tentacle-enterprise' },
    { handle: 'ceph-tentacle-no-subscription', status: 1 },
    { handle: 'ceph-tentacle-test' },
  ],
  errors: [],
}

describe('computeRepoIssues on the lab node with a single Ceph repository', () => {
  it('stays silent on the free layout even though two release handles light up', () => {
    expect(computeRepoIssues(LAB_PVE9_SINGLE_CEPH_REPO_PAYLOAD)).toEqual([])
  })
})

describe('isSubscriptionActive', () => {
  it('accepts the active status PVE sends, whatever its casing or padding', () => {
    expect(isSubscriptionActive('active')).toBe(true)
    expect(isSubscriptionActive(' Active ')).toBe(true)
  })

  it('rejects every other status PVE can answer, and every non-string', () => {
    for (const status of ['new', 'notfound', 'invalid', 'expired', 'suspended', 'unknown', '', undefined, null, 1, true]) {
      expect(isSubscriptionActive(status)).toBe(false)
    }
  })
})

describe('loadNodeRepoIssues', () => {
  type Answer = { json: unknown } | { reject: string } | { badJson: true }

  /** A fetch that answers per URL suffix, recording every call. */
  function fetchAnswering(answers: Record<string, Answer>) {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const impl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const key = Object.keys(answers).find(k => url.endsWith(k))
      const answer = key ? answers[key] : undefined

      if (!answer) throw new Error(`unexpected fetch ${url}`)
      if ('reject' in answer) throw new Error(answer.reject)

      return {
        json: async () => {
          if ('badJson' in answer) throw new SyntaxError('Unexpected token <')

          return answer.json
        },
      }
    })

    return { fetch: impl as unknown as typeof fetch, calls }
  }

  it('lets a subscribed node keep its enterprise-only repositories', async () => {
    const { fetch, calls } = fetchAnswering({
      '/apt/repositories': { json: { data: ISSUE_853_PAYLOAD } },
      '/subscription': { json: { data: { status: 'active', level: 'c' } } },
    })

    await expect(loadNodeRepoIssues('conn-1', 'NAINTPVE01', fetch)).resolves.toEqual([])

    expect(calls.map(c => c.url)).toEqual([
      '/api/v1/connections/conn-1/nodes/NAINTPVE01/apt/repositories',
      '/api/v1/connections/conn-1/nodes/NAINTPVE01/subscription',
    ])
    expect(calls[1].init).toEqual({ cache: 'no-store' })
  })

  it('blocks the same layout when the node has no subscription key', async () => {
    const { fetch } = fetchAnswering({
      '/apt/repositories': { json: { data: ISSUE_853_PAYLOAD } },
      '/subscription': { json: { data: { status: 'notfound' } } },
    })

    await expect(loadNodeRepoIssues('conn-1', 'pve1', fetch)).resolves.toEqual([
      { kind: 'enterprise' },
      { kind: 'enterprise', component: 'Ceph' },
    ])
  })

  it('treats an unreadable subscription as not active, the strict side', async () => {
    const network = fetchAnswering({
      '/apt/repositories': { json: { data: ISSUE_853_PAYLOAD } },
      '/subscription': { reject: 'fetch failed' },
    })
    const html = fetchAnswering({
      '/apt/repositories': { json: { data: ISSUE_853_PAYLOAD } },
      '/subscription': { badJson: true },
    })
    const denied = fetchAnswering({
      '/apt/repositories': { json: { data: ISSUE_853_PAYLOAD } },
      '/subscription': { json: { error: 'Forbidden' } },
    })

    for (const { fetch } of [network, html, denied]) {
      await expect(loadNodeRepoIssues('conn-1', 'pve1', fetch)).resolves.toHaveLength(2)
    }
  })

  it('answers null when the repositories themselves could not be read', async () => {
    const failed = fetchAnswering({
      '/apt/repositories': { reject: 'fetch failed' },
      '/subscription': { json: { data: { status: 'active' } } },
    })
    const errored = fetchAnswering({
      '/apt/repositories': { json: { error: 'PVE 401' } },
      '/subscription': { json: { data: { status: 'active' } } },
    })

    await expect(loadNodeRepoIssues('conn-1', 'pve1', failed.fetch)).resolves.toBeNull()
    await expect(loadNodeRepoIssues('conn-1', 'pve1', errored.fetch)).resolves.toBeNull()
  })

  it('still reports an unparsable repository file on a subscribed node', async () => {
    const { fetch } = fetchAnswering({
      '/apt/repositories': { json: { data: { 'standard-repos': [], errors: LAB_PVE9_PAYLOAD.errors } } },
      '/subscription': { json: { data: { status: 'active' } } },
    })

    await expect(loadNodeRepoIssues('conn-1', 'pve1', fetch)).resolves.toHaveLength(2)
  })

  it('encodes the node name in both URLs', async () => {
    const { fetch, calls } = fetchAnswering({
      '/apt/repositories': { json: { data: { 'standard-repos': [] } } },
      '/subscription': { json: { data: { status: 'notfound' } } },
    })

    await loadNodeRepoIssues('conn-1', 'pve 1', fetch)

    expect(calls[0].url).toBe('/api/v1/connections/conn-1/nodes/pve%201/apt/repositories')
    expect(calls[1].url).toBe('/api/v1/connections/conn-1/nodes/pve%201/subscription')
  })
})

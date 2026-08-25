import { describe, expect, it } from 'vitest'

import {
  computeRepoIssues,
  formatRepoError,
  isRepoEnabled,
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
    expect(issues.some(i => i.kind === 'enterprise' && i.component === 'ceph-squid')).toBe(false)
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
    ).toEqual([{ kind: 'enterprise', component: 'ceph-squid' }])
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

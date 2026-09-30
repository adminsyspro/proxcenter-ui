import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'

import PbsRepositoriesTab from './PbsRepositoriesTab'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

const PAYLOAD = {
  digest: 'abc123digest',
  files: [
    {
      path: '/etc/apt/sources.list.d/pbs-enterprise.list',
      'file-type': 'list',
      repositories: [
        {
          Types: ['deb'],
          URIs: ['https://enterprise.proxmox.com/debian/pbs'],
          Suites: ['bookworm'],
          Components: ['pbs-enterprise'],
          Enabled: true,
        },
      ],
    },
  ],
  'standard-repos': [
    { handle: 'no-subscription', name: 'No-Subscription', status: 'not-configured' },
  ],
}

function mockFetch(postStatus = 200) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return jsonResponse(postStatus, postStatus === 200 ? { data: null } : { error: 'digest mismatch' })
    return jsonResponse(200, { data: PAYLOAD })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function postBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PbsRepositoriesTab', () => {
  it('loads the repositories of the PBS on mount', async () => {
    const fetchMock = mockFetch()
    render(<PbsRepositoriesTab pbsId="pbs-1" />)

    expect(await screen.findByText('no-subscription')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/pbs/pbs-1/repositories', { cache: 'no-store' })
  })

  it('posts a toggle with the file path, index, new state and digest, then reloads', async () => {
    const fetchMock = mockFetch()
    render(<PbsRepositoriesTab pbsId="pbs-1" />)

    const toggle = await screen.findByRole('switch')
    fireEvent.click(toggle)

    await waitFor(() => expect(postBodies(fetchMock)).toEqual([
      { op: 'toggle', path: '/etc/apt/sources.list.d/pbs-enterprise.list', index: 0, enabled: false, digest: 'abc123digest' },
    ]))
    expect(await screen.findByText('inventory.pbsReposActionSuccess')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, i]) => !(i as RequestInit)?.method).length).toBe(2))
  })

  it('posts an add of a standard repository and reports a failure', async () => {
    const fetchMock = mockFetch(409)
    render(<PbsRepositoriesTab pbsId="pbs-1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'inventory.pbsReposActionAdd' }))

    await waitFor(() => expect(postBodies(fetchMock)).toEqual([
      { op: 'add', handle: 'no-subscription', digest: 'abc123digest' },
    ]))
    expect(await screen.findByText('inventory.pbsReposActionError (digest mismatch)')).toBeInTheDocument()
  })
})

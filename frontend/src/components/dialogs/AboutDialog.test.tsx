/**
 * The About dialog on an air-gapped instance (ui#956). Its release history
 * comes straight from api.github.com in the browser, so the dialog must wait
 * for the license status before asking, and never ask once that status says
 * the instance is offline; the update check then explains itself instead of
 * failing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

// Resolved and online by default; the offline and loading cases override it.
let licenseState = { offline: false, loading: false }
vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => licenseState,
}))

// The logo reads the branding settings, which have no bearing here.
vi.mock('@/components/layout/shared/Logo', () => ({ LogoIcon: () => null }))

import AboutDialog from './AboutDialog'

const VERSION_CHECK = {
  currentVersion: '1.4.10',
  latestVersion: '1.4.10',
  updateAvailable: false,
  releaseUrl: null,
  releaseNotes: null,
  releaseDate: null,
  error: null,
}

const RELEASES = [
  { tag_name: 'v1.3.7', published_at: '2026-06-01T00:00:00Z', html_url: 'https://example.test/v1.3.7', body: '' },
  { tag_name: 'v1.4.0-rc1', published_at: '2026-07-01T00:00:00Z', html_url: 'https://example.test/rc1', body: '', prerelease: true },
]

const versionCheckCalls = vi.fn()
const githubCalls = vi.fn()

beforeEach(() => {
  licenseState = { offline: false, loading: false }
  versionCheckCalls.mockClear()
  githubCalls.mockClear()
  server.use(
    http.get('*/api/v1/version/check', () => {
      versionCheckCalls()
      return HttpResponse.json(VERSION_CHECK)
    }),
    http.get('https://api.github.com/repos/adminsyspro/proxcenter-ui/releases', () => {
      githubCalls()
      return HttpResponse.json(RELEASES)
    }),
  )
})

afterEach(cleanup)

describe('AboutDialog', () => {
  it('lists the published releases, without the pre-releases, when the instance is online', async () => {
    renderWithProviders(<AboutDialog open onClose={() => {}} />)

    expect(await screen.findByText('Up to date')).toBeInTheDocument()
    expect(await screen.findByText('v1.3.7')).toBeInTheDocument()
    expect(screen.queryByText('v1.4.0-rc1')).not.toBeInTheDocument()
    expect(githubCalls).toHaveBeenCalledTimes(1)
  })

  it('never asks GitHub on an air-gapped instance, and says why the update check is off', async () => {
    licenseState = { offline: true, loading: false }
    server.use(
      http.get('*/api/v1/version/check', () =>
        HttpResponse.json({ ...VERSION_CHECK, latestVersion: null, error: 'offline' }),
      ),
    )

    renderWithProviders(<AboutDialog open onClose={() => {}} />)

    expect(await screen.findByText('Update checks are disabled on this air-gapped instance')).toBeInTheDocument()
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument()
    expect(screen.queryByText('v1.3.7')).not.toBeInTheDocument()
    expect(githubCalls).not.toHaveBeenCalled()
  })

  it('waits for the license status before asking GitHub', async () => {
    licenseState = { offline: false, loading: true }
    const { rerender } = renderWithProviders(<AboutDialog open onClose={() => {}} />)

    expect(await screen.findByText('Up to date')).toBeInTheDocument()
    expect(githubCalls).not.toHaveBeenCalled()

    licenseState = { offline: false, loading: false }
    rerender(<AboutDialog open onClose={() => {}} />)

    expect(await screen.findByText('v1.3.7')).toBeInTheDocument()
    expect(githubCalls).toHaveBeenCalledTimes(1)
  })

  it('fetches nothing while closed', async () => {
    renderWithProviders(<AboutDialog open={false} onClose={() => {}} />)
    await act(async () => {})

    expect(screen.queryByText('Current version')).not.toBeInTheDocument()
    expect(versionCheckCalls).not.toHaveBeenCalled()
    expect(githubCalls).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import CveTab from './CveTab'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mockScan(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const entry = (over: Record<string, unknown> = {}) => ({
  cveId: 'CVE-2026-38076',
  package: 'jbig2dec',
  installedVersion: '0.20-1',
  fixedVersion: '0.20-1+deb13u1',
  fixAvailable: true,
  severity: 'medium',
  description: 'A heap overflow',
  node: 'pve1',
  publishedAt: '',
  ...over,
})

describe('CveTab', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reports a failed scan instead of showing the clean-node message', async () => {
    // The ui#905 symptom: the tab swallowed every backend error and rendered
    // the green "No vulnerabilities detected" state, so a cluster with no
    // outbound access to the Debian tracker looked perfectly healthy.
    mockScan({ error: 'refresh CVE db: fetch debian tracker: no such host' }, false, 500)

    renderWithProviders(<CveTab connectionId="conn1" node="pve1" available />)

    await waitFor(() => expect(screen.getByText('Scan failed')).toBeTruthy())
    expect(screen.queryByText('No vulnerabilities detected')).toBeNull()
    expect(screen.getByText(/no such host/)).toBeTruthy()
  })

  it('calls an empty result partial when the node was only read through the API', async () => {
    mockScan({
      vulnerabilities: [],
      nodes: [{ node: 'pve1', release: 'trixie', source: 'api', packagesScanned: 62, packagesTracked: 12, fixable: 0, noFix: 0, warning: 'ssh-not-configured' }],
      lastScan: '2026-09-09T12:00:00Z',
    })

    renderWithProviders(<CveTab connectionId="conn1" node="pve1" available />)

    await waitFor(() => expect(screen.getByText('Partial scan')).toBeTruthy())
    expect(screen.getByText(/62 packages scanned, 12 known/)).toBeTruthy()
    expect(screen.getByText(/SSH is not configured/)).toBeTruthy()
  })

  it('keeps the clean-node message for a full inventory with nothing to patch', async () => {
    mockScan({
      vulnerabilities: [],
      nodes: [{ node: 'pve1', release: 'trixie', source: 'ssh', packagesScanned: 929, packagesTracked: 297, fixable: 0, noFix: 0 }],
      lastScan: '2026-09-09T12:00:00Z',
    })

    renderWithProviders(<CveTab connectionId="conn1" node="pve1" available />)

    await waitFor(() => expect(screen.getByText('No vulnerabilities detected')).toBeTruthy())
    expect(screen.getByText(/929 packages scanned, 297 known/)).toBeTruthy()
  })

  it('shows fixable findings first and keeps the unfixed ones behind their filter', async () => {
    mockScan({
      vulnerabilities: [
        entry(),
        entry({ cveId: 'CVE-2026-54369', package: 'acl', fixedVersion: '', fixAvailable: false, installedVersion: '2.3.2-2' }),
        entry({ cveId: 'CVE-2026-54370', package: 'attr', fixedVersion: '', fixAvailable: false, installedVersion: '1:2.5.2-3' }),
      ],
      nodes: [{ node: 'pve1', release: 'trixie', source: 'ssh', packagesScanned: 929, packagesTracked: 297, fixable: 1, noFix: 2 }],
      lastScan: '2026-09-09T12:00:00Z',
    })

    renderWithProviders(<CveTab connectionId="conn1" node="pve1" available />)

    await waitFor(() => expect(screen.getByText('CVE-2026-38076')).toBeTruthy())
    expect(screen.queryByText('CVE-2026-54369')).toBeNull()

    // The unfixed class is announced with its count and one click away.
    const filter = screen.getByText('No fix yet (2)')
    filter.click()

    await waitFor(() => expect(screen.getByText('CVE-2026-54369')).toBeTruthy())
    expect(screen.getByText('CVE-2026-54370')).toBeTruthy()
  })
})

/**
 * Recette N1: the page with the REAL guest list hook (useVMFirewallRules) must not render in a loop. Its reset was a
 * new function on every render and the page lists it in the effect that resets the list on a connection change: the
 * effect ran on every render, reset the "loaded" flag, and the coverage route was read again about once a second
 * ("Maximum update depth exceeded", 0/0 guests). Here the tabs that read the guest list render a stand-in that counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

import enMessages from '@/messages/en.json'

const navigation = vi.hoisted(() => ({ search: '' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/automation/network',
  useSearchParams: () => new URLSearchParams(navigation.search),
}))
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'test' } }, status: 'authenticated' }),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('@/contexts/PageTitleContext', () => ({ usePageTitle: () => ({ setPageInfo: vi.fn() }) }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/contexts/LicenseContext', () => ({ Features: { MICROSEGMENTATION: 'microsegmentation' }, useLicense: () => ({ isEnterprise: true }) }))
vi.mock('@/components/guards/EnterpriseGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/components/guards/ProviderTenantGuard', () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }))
vi.mock('@/lib/api/firewall', () => ({ getVMRules: vi.fn(), getVMOptions: vi.fn() }))
const connections = vi.hoisted(() => ({ data: { data: [{ id: 'dr', name: 'PVE-DR', type: 'pve' }] } }))
vi.mock('@/hooks/useConnections', () => ({ usePVEConnections: () => ({ data: connections.data }) }))
const stable = vi.hoisted(() => ({
  firewall: {
    aliases: [], ipsets: [], securityGroups: [], clusterOptions: { enable: 1 }, clusterRules: [], nodeOptions: null, nodeRules: [],
    firewallMode: 'cluster', connectionInfo: null, nodesList: [], loading: false, loadError: null,
    reload: () => undefined, setClusterRules: () => undefined, setClusterOptions: () => undefined,
  } as Record<string, unknown>,
  // Stable like the real hook's setters: only the guest list hook is under test.
  host: {
    hostRulesByNode: {}, loadingHostRules: false, hostRulesError: null,
    setHostRulesByNode: () => undefined, loadHostRules: async () => undefined, reloadHostRulesForNode: async () => undefined,
  } as Record<string, unknown>,
}))
vi.mock('@/hooks/useFirewallData', () => ({ useFirewallData: () => stable.firewall }))
vi.mock('@/hooks/useHostFirewallRules', () => ({ useHostFirewallRules: () => stable.host }))

const renders = vi.hoisted(() => ({ count: 0 }))
vi.mock('./components/rules/SecurityGroupsPanel', () => ({
  default: ({ vmFirewallData }: { vmFirewallData: unknown[] }) => {
    renders.count += 1
    // A loop fails the test instead of hanging it.
    if (renders.count > 50) throw new Error('render loop')
    return <div data-testid='guests'>{vmFirewallData.length}</div>
  },
}))
vi.mock('./components/RulesTab', () => ({
  default: ({ vmFirewallData }: { vmFirewallData: unknown[] }) => {
    renders.count += 1
    // A loop fails the test instead of hanging it.
    if (renders.count > 50) throw new Error('render loop')
    return <div data-testid='guests'>{vmFirewallData.length}</div>
  },
}))
vi.mock('./components/DashboardTab', () => ({ default: () => <div>dashboard tab</div> }))
vi.mock('./components/ObjectsTab', () => ({ default: () => <div>objects tab</div> }))
vi.mock('./components/LoggingTab', () => ({ default: () => <div>logging tab</div> }))
vi.mock('./components/microseg/MicrosegTab', () => ({ default: () => <div>microseg tab</div> }))

import NetworkAutomationPage from './page'

const COVERAGE = '/api/v1/firewall/coverage/dr'
const row = (vmid: number) => ({ type: 'qemu', node: 'pve1', vmid: String(vmid), name: `vm-${vmid}`, status: 'running', tags: [], enabled: true, optionsEnabled: true, nicFirewall: true, options: null, vlans: [] })
const fetchMock = vi.fn(async (url: string) => {
  if (url.startsWith(COVERAGE)) {
    const guests = [row(100), row(101)]
    return new Response(JSON.stringify({ total: 2, measured: 2, enabled: 2, disabled: 0, unknown: 0, sampled: false, partial: false, computedAt: '2026-11-03T10:00:00Z', computing: false, guests }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
})
const coverageReads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith(COVERAGE)).length

function open(search: string) {
  navigation.search = search
  return render(<NetworkAutomationPage />, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>}>
        <ThemeProvider theme={createTheme()}>
          <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
        </ThemeProvider>
      </NextIntlClientProvider>
    ),
  })
}

beforeEach(() => {
  renders.count = 0
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('network page with the real guest list hook (N1)', () => {
  it.each([['groups', 'Security Groups'], ['firewalling', 'Firewalling']])('opens %s with the guests read once, and settles', async (tab) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    open(`tab=${tab}`)

    expect(await screen.findByText('2')).toBeInTheDocument()
    const settled = renders.count
    // Well past several coverage polls and render rounds: nothing moves any more.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)) })

    expect(coverageReads()).toBe(1)
    expect(renders.count).toBe(settled)
    expect(renders.count).toBeLessThan(10)
    expect(screen.getByTestId('guests').textContent).toBe('2')
    expect(errors.mock.calls.some(call => String(call[0]).includes('Maximum update depth'))).toBe(false)
    errors.mockRestore()
  })
})

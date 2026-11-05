/**
 * The Micro-segmentation tab, fed by the demo mocks instead of the test kit: the map draws the five zones with their
 * members, and nothing is drawn above the sub-tabs, which the demo policy has no reason to fill.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import MicrosegTab from '@/app/(dashboard)/automation/network/components/microseg/MicrosegTab'

import { demoResponse } from '../demo-api'

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@xyflow/react', async () => (await import('@/app/(dashboard)/automation/network/components/microseg/xyflowTestMock')).xyflowMock)

const previousDemoMode = process.env.DEMO_MODE

beforeEach(() => {
  process.env.DEMO_MODE = 'true'
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const res = await demoResponse(new Request(`http://localhost${url}`, init))

    return res ?? new Response('{}', { status: 404 })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  process.env.DEMO_MODE = previousDemoMode
})

describe('Micro-segmentation tab on the demo data', () => {
  it('draws the zones with their members and, above the sub-tabs, the log alert of the busiest node only', async () => {
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0, refreshInterval: 0 }}>
        <MicrosegTab connectionId="demo-pve-cluster-001" />
      </SWRConfig>,
    )

    const web = await screen.findByTestId('node-zone:demo-zone-web')

    for (const [zone, count] of [['web', '5 members'], ['app', '6 members'], ['db', '5 members'], ['monitoring', '3 members'], ['infra', '3 members']]) {
      const node = await screen.findByTestId(`node-zone:demo-zone-${zone}`)

      expect(within(node).getByText(zone)).toBeTruthy()
      await waitFor(() => expect(within(node).getByText(count)).toBeTruthy())
    }

    const row = document.querySelector('.MuiTabs-root')!.parentElement as HTMLElement

    // pve-node-03 met full pages of the log: the strip holds that chip and nothing else.
    const alert = await screen.findByText('Log behind')
    const strip = alert.closest('.MuiPaper-root') as HTMLElement

    expect(row.parentElement!.firstElementChild).toBe(strip)
    expect(strip.querySelectorAll('.MuiChip-root')).toHaveLength(1)
    expect(web).toBeTruthy()
  })
})

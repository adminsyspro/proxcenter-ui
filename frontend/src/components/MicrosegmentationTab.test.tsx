/**
 * Component tests for the custom gateway-offset field of MicrosegmentationTab
 * (discussion #634).
 *
 * The offset used to be coerced with `Number.parseInt(v) || 1` inside onChange,
 * so deleting the last digit wrote 1 straight back and the field could never be
 * emptied. It is now buffered, with its 1..254 bound applied on blur.
 *
 * Committing a new offset re-runs the analysis fetch, because the offset is a
 * dependency of loadAnalysis. The tab used to swap its whole subtree for a
 * spinner while that request was in flight, which unmounted the config dialog
 * and threw away the field mid-word: only the first digit ever landed. The
 * spinner is now gated on there being no analysis yet, so a refetch leaves the
 * dialog standing — hence the multi-digit test below, which is the one that
 * would have failed before.
 */

import { beforeEach, describe, expect, it, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import MicrosegmentationTab from './MicrosegmentationTab'

afterEach(cleanup)

const CONNECTION_ID = 'conn-microseg'

const ANALYSIS = {
  networks: [
    { name: 'vmbr0', cidr: '10.0.0.0/24', comment: '', gateway: '10.0.0.254', has_gateway: true, has_base_sg: true },
  ],
  gateway_aliases: ['gw_vmbr0'],
  base_sgs: ['sg_vmbr0'],
  missing_gateways: [],
  missing_base_sgs: [],
  total_vms: 2,
  isolated_vms: 2,
  unprotected_vms: 0,
  segmentation_ready: true,
}

const VM_LIST = { vms: [], total_vms: 2, isolated_vms: 2, unprotected_vms: 0 }

beforeEach(() => {
  // The tab seeds its config from localStorage; start each test from a known
  // state with 'custom' already selected so the offset field is enabled.
  localStorage.setItem(`microseg-config-${CONNECTION_ID}`, JSON.stringify({
    gatewayMode: 'custom',
    customOffset: 254,
    createGateways: true,
    createBaseSGs: true,
    excludePatterns: ['ceph'],
    showExcluded: true,
  }))

  server.use(
    http.get(`*/api/v1/firewall/microseg/${CONNECTION_ID}/analyze`, () => HttpResponse.json(ANALYSIS)),
    http.get(`*/api/v1/firewall/microseg/${CONNECTION_ID}/vms`, () => HttpResponse.json(VM_LIST)),
  )
})

const offset = () => screen.getByRole('spinbutton') as HTMLInputElement

async function openConfigDialog() {
  renderWithProviders(<MicrosegmentationTab connectionId={CONNECTION_ID} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Configuration' }))
  await screen.findByText('Micro-segmentation Configuration')
}

describe('MicrosegmentationTab custom gateway offset', () => {
  it('shows the offset held in the configuration', async () => {
    await openConfigDialog()
    expect(offset().value).toBe('254')
    expect(offset()).not.toBeDisabled()
  })

  it('lets the offset be cleared without snapping back to 1', async () => {
    await openConfigDialog()
    await userEvent.clear(offset())
    expect(offset().value).toBe('')
  })

  it('keeps every digit while the committed offset refetches the analysis', async () => {
    await openConfigDialog()
    await userEvent.clear(offset())
    await userEvent.type(offset(), '10')

    // Before the spinner was gated on `!analysis`, the first digit re-ran
    // loadAnalysis, unmounted the dialog and left this reading '1'.
    expect(offset().value).toBe('10')
  })

  it('commits the fallback of 1 when the offset is left empty', async () => {
    await openConfigDialog()
    await userEvent.clear(offset())
    await userEvent.click(screen.getByText('Micro-segmentation Configuration'))
    await waitFor(() => expect(offset().value).toBe('1'))
  })
})

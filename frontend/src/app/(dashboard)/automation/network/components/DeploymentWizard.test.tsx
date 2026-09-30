/**
 * DeploymentWizard: entering the apply step fires the sequential rule
 * creation (fire-and-forget `void applyRules()` in the step effect), one
 * addClusterRule call per predefined whitelist rule.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/lib/api/firewall', () => ({
  addClusterRule: vi.fn(),
  updateClusterOptions: vi.fn(),
}))

import * as firewallAPI from '@/lib/api/firewall'

import DeploymentWizard from './DeploymentWizard'

const addClusterRule = firewallAPI.addClusterRule as unknown as ReturnType<typeof vi.fn>

function renderWizard() {
  return renderWithProviders(
    <DeploymentWizard
      open
      onClose={vi.fn()}
      selectedConnection="conn-1"
      clusterOptions={null}
      clusterRules={[]}
      nodesList={['pve1', 'pve2']}
      firewallMode="cluster"
      onComplete={vi.fn()}
    />,
  )
}

function goToApplyStep() {
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

describe('DeploymentWizard apply step', () => {
  beforeEach(() => addClusterRule.mockReset())
  afterEach(cleanup)

  it('creates every whitelist rule on the selected connection', async () => {
    addClusterRule.mockResolvedValue(undefined)
    renderWizard()
    goToApplyStep()

    expect(await screen.findByText('All 8 rules created successfully!')).toBeInTheDocument()
    expect(addClusterRule).toHaveBeenCalledTimes(8)
    expect(addClusterRule).toHaveBeenNthCalledWith(1, 'conn-1', {
      type: 'in', action: 'ACCEPT', enable: 1, proto: 'udp', dport: '5405:5412', comment: 'PVE Cluster - Corosync',
    })
    expect(addClusterRule).toHaveBeenLastCalledWith('conn-1', expect.objectContaining({ dport: '3128', comment: 'PVE Cluster - SPICE Proxy' }))
  })

  it('reports the failed rules when some creations reject', async () => {
    addClusterRule.mockResolvedValue(undefined)
    addClusterRule.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'))
    renderWizard()
    goToApplyStep()

    expect(await screen.findByText('6 of 8 rules created. 2 failed.')).toBeInTheDocument()
  })
})

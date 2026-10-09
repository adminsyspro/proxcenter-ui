/**
 * The same vmid exists on several clusters: an HA resource must be named
 * after the guest of the cluster the rule belongs to.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import HaRuleDialog from './HaRuleDialog'

afterEach(() => {
  cleanup()
})

describe('HaRuleDialog', () => {
  it('names a resource after the guest of its own cluster', () => {
    renderWithProviders(
      <HaRuleDialog
        open
        onClose={vi.fn()}
        rule={null}
        ruleType="resource-affinity"
        connId="c-nsk"
        availableNodes={[]}
        availableResources={[{ sid: 'vm:100' }]}
        allVms={[
          { connId: 'c-ckm', vmid: 100, name: 'CKMVM001', status: 'running' },
          { connId: 'c-nsk', vmid: 100, name: 'MHOVM001', status: 'running' },
        ]}
        onSaved={vi.fn()}
      />
    )

    expect(screen.getByText('MHOVM001')).toBeInTheDocument()
    expect(screen.queryByText('CKMVM001')).not.toBeInTheDocument()
  })
})

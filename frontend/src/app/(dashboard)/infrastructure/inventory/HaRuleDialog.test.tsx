/**
 * The same vmid exists on several clusters: an HA resource must be named
 * after the guest of the cluster the rule belongs to.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
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

// Proxmox VE 9.3: a node-affinity rule can keep its resources off its nodes
// (rule `pve93-neg` of the lab, 26/11: vm:9931 kept off pve3-dr, strict).
describe('HaRuleDialog - node affinity direction (Proxmox VE 9.3)', () => {
  const NODES = [{ node: 'pve1-dr', status: 'online' }, { node: 'pve2-dr', status: 'online' }, { node: 'pve3-dr', status: 'online' }]
  const NEGATIVE = { rule: 'pve93-neg', type: 'node-affinity', affinity: 'negative', strict: 1, nodes: 'pve3-dr', resources: 'vm:9931' }

  function render(props: Record<string, unknown>) {
    return renderWithProviders(
      <HaRuleDialog
        open
        onClose={vi.fn()}
        rule={null}
        ruleType="node-affinity"
        connId="c-dr"
        availableNodes={NODES}
        availableResources={[{ sid: 'vm:9931' }]}
        allVms={[{ connId: 'c-dr', vmid: 9931, name: 'pve93-dst-b', status: 'stopped' }]}
        onSaved={vi.fn()}
        {...props}
      />
    )
  }

  function captureBodies() {
    const bodies: Array<{ url: string; method: string; body: any }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init?: any) => {
      bodies.push({ url: String(url), method: init?.method, body: JSON.parse(init?.body || '{}') })

      return new Response(JSON.stringify({ data: null }), { status: 200 })
    })

    return bodies
  }

  afterEach(() => vi.restoreAllMocks())

  it('shows a negative rule as such and says what it does', () => {
    render({ rule: NEGATIVE })

    expect(screen.getByText('Keep off the selected nodes')).toBeInTheDocument()
    expect(screen.getByText(/keeps HA-managed VMs off the selected nodes/)).toBeInTheDocument()
    expect(screen.getByText('Never run on the selected nodes')).toBeInTheDocument()
  })

  it('keeps the direction of a negative rule when it is edited', async () => {
    const bodies = captureBodies()
    render({ rule: { ...NEGATIVE, nodes: 'pve3-dr,pve1-dr' } })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].method).toBe('PUT')
    expect(bodies[0].body).toMatchObject({ nodes: 'pve3-dr,pve1-dr', affinity: 'negative', strict: true })
  })

  it('keeps the node priorities of a positive rule, drops them when it turns negative', async () => {
    const bodies = captureBodies()
    render({ rule: { rule: 'pin', type: 'node-affinity', nodes: 'pve3-dr:2,pve1-dr', resources: 'vm:9931' }, nodeAffinityDirection: true })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].body).toMatchObject({ nodes: 'pve3-dr:2,pve1-dr', affinity: 'positive' })

    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Keep off the selected nodes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1].body).toMatchObject({ nodes: 'pve3-dr,pve1-dr', affinity: 'negative' })
  })

  it('creates a negative rule where the cluster runs Proxmox VE 9.3', async () => {
    const bodies = captureBodies()
    render({ nodeAffinityDirection: true })

    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'keep-off-pve3' } })
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'Keep off the selected nodes' }))
    fireEvent.click(screen.getByText('pve93-dst-b'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('pve3-dr'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].body).toMatchObject({ type: 'node-affinity', rule: 'keep-off-pve3', nodes: 'pve3-dr', affinity: 'negative', resources: 'vm:9931' })
  })

  it('offers no direction on an older cluster, and sends none', async () => {
    const bodies = captureBodies()
    render({})

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'pin' } })
    fireEvent.click(screen.getByText('pve93-dst-b'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('pve1-dr'))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0].body.affinity).toBeUndefined()
  })
})

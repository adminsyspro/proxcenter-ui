/**
 * DeploymentWizard: it turns the cluster firewall on and writes nothing else (no cluster rule, no inbound policy,
 * nothing on the nodes), and says which nodes turn their own firewall on with the cluster.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/lib/api/firewall', () => ({
  addClusterRule: vi.fn(),
  addNodeRule: vi.fn(),
  updateNodeOptions: vi.fn(),
  getNodeOptions: vi.fn(),
  updateClusterOptions: vi.fn(),
}))

const getPreflight = vi.fn()
vi.mock('@/lib/microseg/api', () => ({ microsegApi: () => ({ getPreflight }) }))

import * as firewallAPI from '@/lib/api/firewall'

import DeploymentWizard, { nodeFirewallOf } from './DeploymentWizard'

const api = firewallAPI as unknown as Record<'addClusterRule' | 'addNodeRule' | 'updateNodeOptions' | 'getNodeOptions' | 'updateClusterOptions', ReturnType<typeof vi.fn>>

function renderWizard(onComplete = vi.fn()) {
  return renderWithProviders(
    <DeploymentWizard
      open
      onClose={vi.fn()}
      selectedConnection='conn-1'
      clusterOptions={null}
      clusterRules={[]}
      nodesList={['pve1', 'pve2', 'pve3']}
      firewallMode='cluster'
      onComplete={onComplete}
    />,
  )
}

/** pve1 off, pve2 with no flag (it follows the cluster), pve3 not readable. */
function nodes(over: Record<string, unknown> = {}) {
  const options: Record<string, unknown> = { pve1: { enable: 0 }, pve2: {}, pve3: new Error('boom'), ...over }
  api.getNodeOptions.mockImplementation(async (_c: string, node: string) => {
    const o = options[node]
    if (o instanceof Error) throw o
    return o
  })
}

describe('nodeFirewallOf', () => {
  it('reads a node firewall as off only with an explicit 0, as PVE does', () => {
    expect(nodeFirewallOf({ enable: 0 })).toBe('off')
    expect(nodeFirewallOf({ enable: '0' as unknown as number })).toBe('off')
    expect(nodeFirewallOf({ enable: 1 })).toBe('follows')
    expect(nodeFirewallOf({})).toBe('follows')
    expect(nodeFirewallOf(null)).toBe('unknown')
  })
})

describe('DeploymentWizard', () => {
  beforeEach(() => {
    Object.values(api).forEach(fn => fn.mockReset())
    getPreflight.mockReset()
    getPreflight.mockResolvedValue([{ id: 'node_traffic', status: 'pass' }])
  })
  afterEach(cleanup)

  it('has three steps and no step of rules', () => {
    nodes()
    renderWizard()
    for (const step of ['Analysis', 'Activate', 'Done']) expect(screen.getByText(step)).toBeInTheDocument()
    expect(screen.queryByText('Preview')).toBeNull()
    expect(screen.queryByText('Apply')).toBeNull()
  })

  it('names the nodes that turn their own firewall on with the cluster, and those it could not read', async () => {
    nodes()
    renderWizard()
    expect((await screen.findByTestId('wizard-node-firewalls')).textContent).toBe('1 node turns its own firewall on with the cluster: pve2')
    expect(screen.getByTestId('wizard-nodes-follow').textContent).toContain('On pve2, the node\'s own firewall is not set to off')
    expect(screen.getByText(/The firewall of pve3 could not be read/)).toBeInTheDocument()
    // One read per node, nothing written while the analysis is shown.
    expect(api.getNodeOptions).toHaveBeenCalledTimes(3)
    expect(api.updateNodeOptions).not.toHaveBeenCalled()
  })

  it('says every node firewall is off when they all are', async () => {
    nodes({ pve2: { enable: 0 }, pve3: { enable: 0 } })
    renderWizard()
    expect((await screen.findByTestId('wizard-node-firewalls')).textContent).toContain('The firewall of every node is off')
    expect(screen.queryByTestId('wizard-nodes-follow')).toBeNull()
  })

  it('turns the cluster firewall on and writes nothing else: no rule, no policy, nothing on the nodes', async () => {
    nodes()
    api.updateClusterOptions.mockResolvedValue(undefined)
    const onComplete = vi.fn()
    renderWizard(onComplete)
    await screen.findByTestId('wizard-node-firewalls')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByText('Cluster firewall enabled')).toBeInTheDocument()
    expect(api.updateClusterOptions).toHaveBeenCalledTimes(1)
    expect(api.updateClusterOptions).toHaveBeenCalledWith('conn-1', { enable: 1 })
    expect(api.addClusterRule).not.toHaveBeenCalled()
    expect(api.addNodeRule).not.toHaveBeenCalled()
    expect(api.updateNodeOptions).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('refuses to go on when the node firewalls would cut what the nodes exchange, and names it', async () => {
    nodes()
    getPreflight.mockResolvedValue([{
      id: 'node_traffic', status: 'fail', fix: 'node_traffic',
      detail: { blocked: [
        { kind: 'ceph_public', network: '10.250.250.0/24', ports: '3300, 6789, 6800-7300', nodes: ['pve2', 'pve3'] },
        { kind: 'migration', network: '10.51.51.0/24', ports: '22', nodes: ['pve2'] },
      ] },
    }])
    renderWizard()
    const alert = await screen.findByTestId('wizard-traffic-cut')
    expect(alert.textContent).toBe('Turning the cluster firewall on now would cut traffic between the nodes. Set the node firewalls to off (enable: 0), or add cluster rules that accept it, then open this wizard again. '
      + 'Ceph (public network 10.250.250.0/24, TCP 3300, 6789, 6800-7300) would be cut on pve2, pve3. Migration (10.51.51.0/24, TCP 22) would be cut on pve2.')
    expect(getPreflight).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(api.updateClusterOptions).not.toHaveBeenCalled()
  })

  it('goes on as before when the check only doubts, or cannot be read', async () => {
    nodes()
    getPreflight.mockResolvedValue([{ id: 'node_traffic', status: 'warn', detail: { unsure: [{ kind: 'ceph_public', network: '10.250.250.0/24', ports: '3300', nodes: ['pve2'] }] } }])
    const first = renderWizard()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled())
    expect(screen.queryByTestId('wizard-traffic-cut')).toBeNull()
    first.unmount()

    getPreflight.mockRejectedValue(new Error('no licence'))
    renderWizard()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled())
    expect(screen.queryByTestId('wizard-traffic-cut')).toBeNull()
  })

  it('stays on the activation with an error when the cluster firewall cannot be turned on', async () => {
    nodes()
    api.updateClusterOptions.mockRejectedValue(new Error('boom'))
    const onComplete = vi.fn()
    renderWizard(onComplete)
    await screen.findByTestId('wizard-node-firewalls')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))

    expect(await screen.findByText(/The cluster firewall could not be turned on/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Activate' })).not.toBeDisabled())
    expect(onComplete).not.toHaveBeenCalled()
  })
})

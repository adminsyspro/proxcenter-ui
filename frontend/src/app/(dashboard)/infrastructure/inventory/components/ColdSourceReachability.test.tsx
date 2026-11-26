/**
 * Cold vCenter source reachability (single VM and bulk dialogs): what the
 * operator reads for each verdict of the test lease and the node's probe, and
 * when the launch is held.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import {
  ColdBatchReachAlert, ColdSourceReachAlert, bulkColdState, coldBatchBlocksLaunch, coldSourceBlocksLaunch, hostedCloudShape,
  type ColdBatchReachState, type ColdSourceReachState,
} from './ColdSourceReachability'

const up = { host: '10.42.0.22', port: 443, resolved: true, open: true }
const down = { host: 'vc-proxy.example.com', port: 8443, resolved: true, open: false }
const unresolved = { host: 'nope.example.com', port: 443, resolved: false, open: false }
const done = (reach: any): ColdSourceReachState => ({ key: 'k', loading: false, reach })

afterEach(() => {
  cleanup()
})

describe('coldSourceBlocksLaunch', () => {
  it('holds the launch while the check runs and on a blocked verdict only', () => {
    expect(coldSourceBlocksLaunch(null)).toBe(false)
    expect(coldSourceBlocksLaunch({ key: 'k', loading: true, reach: null })).toBe(true)
    expect(coldSourceBlocksLaunch(done({ status: 'blocked', node: 'pve3', endpoints: [down] }))).toBe(true)
    expect(coldSourceBlocksLaunch(done({ status: 'ok', node: 'pve3', endpoints: [up] }))).toBe(false)
    expect(coldSourceBlocksLaunch(done({ status: 'error', node: 'pve3', error: 'x' }))).toBe(false)
    expect(coldSourceBlocksLaunch(done({ status: 'skipped', reason: 'poweredOn' }))).toBe(false)
    expect(coldSourceBlocksLaunch(done(null))).toBe(false)
  })
})

describe('coldBatchBlocksLaunch', () => {
  it('holds the batch while it is checked and when a node cannot reach a source host', () => {
    const reach = { problems: [], unchecked: [], errors: [{ node: 'pve2', error: 'ssh down' }] }
    expect(coldBatchBlocksLaunch({ status: 'idle' })).toBe(false)
    expect(coldBatchBlocksLaunch({ status: 'checking' })).toBe(true)
    expect(coldBatchBlocksLaunch({ status: 'done', reach })).toBe(false)
    expect(coldBatchBlocksLaunch({ status: 'done', reach: { ...reach, problems: [{ node: 'pve3', endpoints: [down], vms: ['web'] }] } })).toBe(true)
  })
})

describe('bulkColdState', () => {
  it('is idle without a request, checking until the answer of that request, idle on an unreadable answer', () => {
    const reach = { problems: [], unchecked: [], errors: [] }
    expect(bulkColdState(null, { key: 'a', reach })).toEqual({ status: 'idle' })
    expect(bulkColdState('b', null)).toEqual({ status: 'checking' })
    expect(bulkColdState('b', { key: 'a', reach })).toEqual({ status: 'checking' })
    expect(bulkColdState('a', { key: 'a', reach })).toEqual({ status: 'done', reach })
    expect(bulkColdState('a', { key: 'a', reach: null })).toEqual({ status: 'idle' })
  })
})

describe('hostedCloudShape', () => {
  it('is the vCenter answering on 443 while the host does not on 902', () => {
    const vcOpen = { host: 'vc', resolved: true, open: true }
    expect(hostedCloudShape({ ports: { 902: false }, vcenter: vcOpen })).toBe(true)
    expect(hostedCloudShape({ ports: { 902: true }, vcenter: vcOpen })).toBe(false)
    expect(hostedCloudShape({ ports: { 902: false }, vcenter: { ...vcOpen, open: false } })).toBe(false)
    expect(hostedCloudShape({ ports: { 902: false } })).toBe(false)
    expect(hostedCloudShape({ ports: { 902: false }, vcenter: vcOpen, error: 'ssh' })).toBe(false)
    expect(hostedCloudShape(null)).toBe(false)
  })
})

describe('ColdSourceReachAlert', () => {
  it('shows the check in flight, then the reachable address', () => {
    const { rerender } = renderWithProviders(<ColdSourceReachAlert state={{ key: 'k', loading: true, reach: null }} node="pve3" />)
    expect(screen.getByTestId('mig-cold-source-checking').textContent).toContain('pve3')
    rerender(<ColdSourceReachAlert state={done({ status: 'ok', node: 'pve3', endpoints: [up] })} node="pve3" />)
    expect(screen.getByTestId('mig-cold-source-ok').textContent).toContain('10.42.0.22:443')
  })

  it('names only the addresses down, an unresolved name as such, and where the download runs', () => {
    renderWithProviders(<ColdSourceReachAlert state={done({ status: 'blocked', node: 'pve3', endpoints: [up, down, unresolved] })} node="pve3" />)
    const text = screen.getByTestId('mig-cold-source-blocked').textContent || ''
    expect(text).toContain('vc-proxy.example.com:8443')
    expect(text).toContain('nope.example.com (name not resolved on the node)')
    expect(text).not.toContain('10.42.0.22')
    expect(text).toContain('not on ProxCenter')
  })

  it('warns without blocking when the test could not run, and shows nothing when skipped', () => {
    const { rerender, container } = renderWithProviders(<ColdSourceReachAlert state={done({ status: 'error', node: 'pve3', error: 'ExportVm failed: busy' })} node="pve3" />)
    expect(screen.getByTestId('mig-cold-source-error').textContent).toContain('ExportVm failed: busy')
    rerender(<ColdSourceReachAlert state={done({ status: 'skipped', reason: 'poweredOn' })} node="pve3" />)
    expect(container.querySelector('[data-testid^="mig-cold-source"]')).toBeNull()
    rerender(<ColdSourceReachAlert state={null} node="pve3" />)
    expect(container.querySelector('[data-testid^="mig-cold-source"]')).toBeNull()
  })
})

describe('ColdBatchReachAlert', () => {
  it('lists each node, address and VMs it blocks, and the nodes it could not test apart', () => {
    const state: ColdBatchReachState = { status: 'done', reach: { problems: [{ node: 'pve3', endpoints: [down], vms: ['web', 'db'] }], unchecked: [], errors: [{ node: 'pve2', error: 'ssh down' }] } }
    renderWithProviders(<ColdBatchReachAlert state={state} />)
    const text = screen.getByTestId('bulk-cold-source-error').textContent || ''
    expect(text).toContain('pve3')
    expect(text).toContain('vc-proxy.example.com:8443')
    expect(text).toContain('web, db')
    expect(screen.getByTestId('bulk-cold-source-warning').textContent).toContain('ssh down')
  })

  it('shows the check in flight, and nothing when idle or clean', () => {
    const { rerender, container } = renderWithProviders(<ColdBatchReachAlert state={{ status: 'checking' }} />)
    expect(screen.getByTestId('bulk-cold-source-checking')).toBeTruthy()
    rerender(<ColdBatchReachAlert state={{ status: 'idle' }} />)
    expect(container.querySelector('[data-testid^="bulk-cold-source"]')).toBeNull()
    rerender(<ColdBatchReachAlert state={{ status: 'done', reach: { problems: [], unchecked: ['live'], errors: [] } }} />)
    expect(container.querySelector('[data-testid^="bulk-cold-source"]')).toBeNull()
  })
})

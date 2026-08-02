import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import VmHeatmapWidget from './VmHeatmapWidget'

/**
 * Regression cover for #611: applying a filter that matches no guest used to
 * replace the whole widget with a bare "No data" card, taking the mode toggle
 * and the threshold button down with it. The user was then stuck until a full
 * page reload, because that state lives in the component.
 */

// This project does not enable Vitest globals, so RTL's auto-cleanup is off.
afterEach(cleanup)

type Guest = Record<string, unknown>

const guest = (over: Guest = {}): Guest => ({
  id: 'qemu/100', vmid: 100, name: 'web-01', node: 'obsidian-host', connId: 'c1',
  type: 'qemu', status: 'running', cpu: 0.01, mem: 1024, maxmem: 4096, template: false,
  ...over,
})

// Three near-idle running guests, as in the reported dashboard (1%, 0%, 0%).
const idleData = {
  clusters: [{ id: 'c1', name: 'cluster-1' }],
  vmList: [
    guest(),
    guest({ id: 'qemu/101', vmid: 101, name: 'web-02', cpu: 0 }),
    guest({ id: 'qemu/102', vmid: 102, name: 'db-01', cpu: 0 }),
  ],
  lxcList: [],
}

const render = (data: unknown) =>
  renderWithProviders(
    <VmHeatmapWidget data={data} loading={false} config={{}} onUpdateSettings={() => {}} />,
  )

// 'Status' is the one mode label that never doubles as a legend caption, and
// it is the toggle that always widens the view back out to every guest.
const expectEscapeHatch = () => expect(screen.getByText('Status')).toBeInTheDocument()

describe('VmHeatmapWidget empty states', () => {
  it('renders the guests grouped by node by default', () => {
    render(idleData)
    expect(screen.getByText('obsidian-host')).toBeInTheDocument()
    expect(screen.getByText('(3)')).toBeInTheDocument()
  })

  it('keeps its controls when the threshold filters every guest out', () => {
    render(idleData)

    // Cycles the threshold from "all" to ">20%" — no guest reaches 20%.
    fireEvent.click(screen.getByText('All'))

    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.queryByText('obsidian-host')).not.toBeInTheDocument()

    // The bug: these used to vanish along with the grid, stranding the user.
    expectEscapeHatch()
    expect(screen.getByText('>20%')).toBeInTheDocument()
    expect(screen.getByText('Reset')).toBeInTheDocument()
  })

  it('restores the guests when the reset affordance is used', () => {
    render(idleData)
    fireEvent.click(screen.getByText('All'))
    expect(screen.getByText('No results')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Reset'))

    expect(screen.queryByText('No results')).not.toBeInTheDocument()
    expect(screen.getByText('obsidian-host')).toBeInTheDocument()
  })

  it('keeps its controls when a mode filters every guest out', () => {
    // CPU and RAM modes only ever show running guests.
    render({ ...idleData, vmList: idleData.vmList.map(g => ({ ...g, status: 'stopped' })) })

    expect(screen.getByText('No results')).toBeInTheDocument()
    expectEscapeHatch()

    // Recovers in place — no page reload, which was the only way out before.
    fireEvent.click(screen.getByText('Status'))
    expect(screen.getByText('obsidian-host')).toBeInTheDocument()
  })

  it('falls back to the plain no-data card when there is genuinely nothing', () => {
    render({ clusters: [], vmList: [], lxcList: [] })

    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
  })

  it('does not offer a reset when no filter is responsible', () => {
    // Templates are always excluded, so the grid is empty with no filter on.
    render({ ...idleData, vmList: [guest({ template: true })] })

    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.queryByText('Reset')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

const { fetchRrd, buildSeriesFromRrd } = vi.hoisted(() => ({
  fetchRrd: vi.fn(),
  buildSeriesFromRrd: vi.fn(),
}))

vi.mock('../../inventory/helpers', () => ({ fetchRrd, buildSeriesFromRrd }))
vi.mock('../../inventory/components/RrdCharts', () => ({
  AreaPctChart: ({ data }: { data: unknown[] }) => <div data-testid="pct-chart">{data.length}</div>,
  AreaBpsChart2: () => <div data-testid="bps-chart" />,
}))

import VmDetailDrawer from './VmDetailDrawer'

const vm = { id: 'c1:pve1:100', name: 'web-01', node: 'pve1', connId: 'c1', type: 'qemu', vmid: 100 }

describe('VmDetailDrawer', () => {
  afterEach(() => {
    cleanup()
    fetchRrd.mockReset()
    buildSeriesFromRrd.mockReset()
  })

  it('loads the VM RRD for the hour timeframe when a VM is given', async () => {
    const raw = [{ time: 1, cpu: 0.2 }]
    fetchRrd.mockResolvedValue(raw)
    buildSeriesFromRrd.mockReturnValue([{ t: 1, cpuPct: 20 }])

    renderWithProviders(<VmDetailDrawer vm={vm} onClose={vi.fn()} />)

    expect(screen.getByText('web-01')).toBeInTheDocument()
    await waitFor(() => expect(fetchRrd).toHaveBeenCalledWith('c1', '/nodes/pve1/qemu/100', 'hour'))
    await waitFor(() => expect(buildSeriesFromRrd).toHaveBeenCalledWith(raw))
  })

  it('does not fetch anything without a VM', () => {
    renderWithProviders(<VmDetailDrawer vm={null} onClose={vi.fn()} />)
    expect(fetchRrd).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import MigrationHistoryTab from './MigrationHistoryTab'
import type { MigrationHistoryEntry } from './migrationHistory'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (k: string, vals?: Record<string, unknown>) =>
    vals ? `${k} ${JSON.stringify(vals)}` : k
}))

// The donut cards size themselves through ChartContainer's ResizeObserver,
// which jsdom does not provide and which would measure zero anyway. The
// numbers under test live in plain Typography, not in the chart.
vi.mock('@/components/ChartContainer', () => ({ default: () => null }))

afterEach(cleanup)

const migration = (over: Partial<MigrationHistoryEntry> = {}): MigrationHistoryEntry => ({
  id: 'm1',
  connection_id: 'prod',
  vmid: 9400,
  vm_name: 'Debian13',
  source_node: 'pve1',
  target_node: 'pve3',
  started_at: '2026-09-06T09:50:10.000Z',
  completed_at: '2026-09-06T09:50:18.000Z',
  status: 'completed',
  ...over
})

const names = { prod: 'PVE-PROD' }

describe('MigrationHistoryTab', () => {
  it('renders skeletons without summary tiles while an empty history is loading', () => {
    const { container } = render(<MigrationHistoryTab migrations={[]} connectionNames={names} loading />)

    expect(container.querySelectorAll('.MuiSkeleton-root')).toHaveLength(3)
    expect(screen.queryByText('drsPage.historyTotal')).not.toBeInTheDocument()
  })

  it('renders the empty state without summary tiles when loading is finished', () => {
    render(<MigrationHistoryTab migrations={[]} connectionNames={names} />)

    expect(screen.getByText('drsPage.noRecentMigrations')).toBeInTheDocument()
    expect(screen.getByText('drsPage.historyEmptyDesc')).toBeInTheDocument()
    expect(screen.queryByText('drsPage.historyTotal')).not.toBeInTheDocument()
  })

  it('shows total, completed, and failed counts in the summary', () => {
    render(
      <MigrationHistoryTab
        migrations={[
          migration(),
          migration({ id: 'm2', vmid: 9401 }),
          migration({ id: 'm3', vmid: 9402, status: 'failed' })
        ]}
        connectionNames={names}
      />
    )

    expect(within(screen.getByText('drsPage.historyTotal').parentElement!).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByText('drsPage.historyCompleted').parentElement!).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByText('drsPage.historyFailed').parentElement!).getByText('1')).toBeInTheDocument()
  })

  it('shows every guest, migration path, and cluster name', () => {
    render(
      <MigrationHistoryTab
        migrations={[
          migration(),
          migration({ id: 'm2', vmid: 9401, vm_name: 'Web01', source_node: 'pve2', target_node: 'pve4' })
        ]}
        connectionNames={names}
      />
    )

    expect(screen.getByText('Debian13')).toBeInTheDocument()
    expect(screen.getByText('Web01')).toBeInTheDocument()
    expect(screen.getByText('pve1')).toBeInTheDocument()
    expect(screen.getByText('pve3')).toBeInTheDocument()
    expect(screen.getByText('pve2')).toBeInTheDocument()
    expect(screen.getByText('pve4')).toBeInTheDocument()
    expect(screen.getAllByText(/PVE-PROD/)).toHaveLength(2)
  })

  it('shows a stored reason and the no-reason key when one is absent', () => {
    render(
      <MigrationHistoryTab
        migrations={[migration({ reason: 'Node load exceeded target' }), migration({ id: 'm2', vmid: 9401 })]}
        connectionNames={names}
      />
    )

    expect(screen.getByText('Node load exceeded target')).toBeInTheDocument()
    expect(screen.getByText('drsPage.historyNoReason')).toBeInTheDocument()
  })

  it('marks maintenance evacuations and draws the guest and node glyphs with their status dots', () => {
    const { container } = render(
      <MigrationHistoryTab
        migrations={[migration({ guest_type: 'lxc', maintenance_evacuation: true })]}
        connectionNames={names}
        vmStatus={{ 'prod:9400': 'running' }}
        nodeStatus={{ 'prod:pve1': 'online', 'prod:pve3': 'maintenance' }}
      />
    )

    expect(screen.getByText('drsPage.evacuation')).toBeInTheDocument()

    // The guest type is carried by its icon, never by a "CT" chip.
    expect(container.querySelector('.ri-instance-line')).not.toBeNull()
    expect(container.querySelector('.ri-computer-line')).toBeNull()
    expect(screen.queryByText('CT')).not.toBeInTheDocument()

    // Source and target nodes each carry the Proxmox logo.
    expect(container.querySelectorAll('img[src*="proxmox-logo"]')).toHaveLength(2)
  })

  it('paginates past 20 rows and hides the pager below that', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      migration({ id: `m${i}`, vmid: 1000 + i, vm_name: `guest-${String(i).padStart(2, '0')}` })
    )
    const { rerender } = render(<MigrationHistoryTab migrations={many} connectionNames={names} />)

    expect(screen.getAllByText(/^guest-\d\d$/)).toHaveLength(20)
    expect(screen.getByText(/drsPage\.historyDisplayedRows/)).toBeInTheDocument()
    expect(screen.getByText('common.rowsPerPage')).toBeInTheDocument()

    rerender(<MigrationHistoryTab migrations={many.slice(0, 5)} connectionNames={names} />)
    expect(screen.getAllByText(/^guest-\d\d$/)).toHaveLength(5)
    expect(screen.queryByText(/drsPage\.historyDisplayedRows/)).not.toBeInTheDocument()
  })

  it('shows failed, completed, and running status labels', () => {
    render(
      <MigrationHistoryTab
        migrations={[
          migration(),
          migration({ id: 'm2', vmid: 9401, status: 'failed' }),
          migration({ id: 'm3', vmid: 9402, status: 'running', completed_at: null })
        ]}
        connectionNames={names}
      />
    )

    // Status is a glyph: the label only lives in its accessible name and tooltip.
    expect(screen.getByLabelText('drsPage.historyStatusFailed')).toBeInTheDocument()
    expect(screen.getByLabelText('drsPage.historyStatusCompleted')).toBeInTheDocument()
    expect(screen.getByLabelText('drsPage.historyStatusRunning')).toBeInTheDocument()
    expect(screen.queryByText('drsPage.historyStatusCompleted')).not.toBeInTheDocument()
  })

  it('carries the error of a failed migration in the status glyph', () => {
    const { container } = render(
      <MigrationHistoryTab
        migrations={[migration({ status: 'failed', error: 'storage full on pve3' })]}
        connectionNames={names}
      />
    )

    expect(screen.getByLabelText('drsPage.historyStatusFailed: storage full on pve3')).toBeInTheDocument()
    expect(container.querySelector('.ri-close-circle-fill')).not.toBeNull()
    expect(container.querySelector('.ri-checkbox-circle-fill')).toBeNull()
  })

  it('narrows rows by VMID and shows the no-match message for an unmatched name', () => {
    render(
      <MigrationHistoryTab
        migrations={[
          migration(),
          migration({ id: 'm2', vmid: 9401, vm_name: 'Web01' }),
          migration({ id: 'm3', vmid: 9402, vm_name: 'Database01' })
        ]}
        connectionNames={names}
      />
    )

    const search = screen.getByLabelText('drsPage.historySearch')

    fireEvent.change(search, { target: { value: '9401' } })
    expect(screen.getByText('Web01')).toBeInTheDocument()
    expect(screen.queryByText('Debian13')).not.toBeInTheDocument()
    expect(screen.queryByText('Database01')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'does-not-exist' } })
    expect(screen.getByText('drsPage.historyNoMatch')).toBeInTheDocument()
  })

  it('renders the cluster filter only when there is more than one connection name', () => {
    const { rerender } = render(<MigrationHistoryTab migrations={[migration()]} connectionNames={names} />)

    expect(screen.queryByLabelText('drsPage.clusterLabel')).not.toBeInTheDocument()

    rerender(
      <MigrationHistoryTab
        migrations={[migration()]}
        connectionNames={{ prod: 'PVE-PROD', dr: 'PVE-DR' }}
      />
    )
    expect(screen.getByLabelText('drsPage.clusterLabel')).toBeInTheDocument()
  })
})

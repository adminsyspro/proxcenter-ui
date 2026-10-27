/**
 * Component tests for the change journal: the one-line rows, the details a
 * row opens on (before/after table, burst net effect and history, backup task,
 * created and deleted guests), the filters, the activity timeline and the
 * pager.
 *
 * recharts measures a real layout jsdom does not have, so it is stubbed: the
 * stubs call the props the timeline hands it (bar shape, tooltip content, tick
 * formatter, chart click) so what the timeline does with them is exercised.
 */

import type { ReactElement, ReactNode } from 'react'
import { Children, cloneElement, isValidElement } from 'react'

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, within } from '@/__tests__/setup/renderWithProviders'

import type { JournalChange } from '@/lib/changes/journal'

type Row = Record<string, any>

vi.mock('@/components/ChartContainer', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid='chart-container'>{children}</div>
}))

vi.mock('recharts', () => {
  const BarChart = ({ data, onClick, children }: { data: Row[]; onClick: (s: unknown) => void; children: ReactNode }) => (
    <div data-testid='bar-chart'>
      {data.map((_row, i) => (
        <button key={i} type='button' aria-label={`slot-${i}`} onClick={() => onClick({ activeTooltipIndex: i })} />
      ))}
      {Children.map(children, child => (isValidElement(child) ? cloneElement(child as ReactElement<any>, { data }) : child))}
    </div>
  )

  const Bar = ({ data, shape, dataKey }: { data: Row[]; shape: (p: unknown) => ReactNode; dataKey: string }) => (
    <div data-testid={`bar-${dataKey}`}>
      {data.filter(row => row[dataKey] > 0).map((row, i) => <div key={i}>{shape({ payload: row, x: 0, y: 0, width: 4, height: 4 })}</div>)}
    </div>
  )

  const Tooltip = ({ data, content }: { data: Row[]; content: (p: unknown) => ReactNode }) => (
    <div data-testid='tooltip'>
      {content({ active: false, payload: [] })}
      {content({ active: true, payload: [{ payload: data.find(r => r.total > 0) }] })}
      {content({ active: true, payload: [{ payload: data.find(r => r.total === 0) }] })}
    </div>
  )

  const XAxis = ({ data, tickFormatter }: { data: Row[]; tickFormatter: (v: number) => string }) => (
    <div data-testid='x-axis'>{data.length ? tickFormatter(data[0].from) : ''}</div>
  )

  return {
    BarChart,
    Bar,
    Tooltip,
    XAxis,
    YAxis: () => null,
    CartesianGrid: () => null,
    Rectangle: ({ radius, fillOpacity }: { radius: unknown; fillOpacity: number }) => (
      <span data-testid='rect' data-radius={JSON.stringify(radius)} data-opacity={fillOpacity} />
    )
  }
})

import ChangeJournal from './ChangeJournal'

const MIN = 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

const base = { connectionId: 'c1', connectionName: 'PVE-PROD', node: 'pve1', user: 'system', resourceType: 'vm' }
const f = (field: string, oldValue: string, newValue: string) => ({ field, oldValue, newValue })

const CHANGES: JournalChange[] = [
  // A single fact, read as it is
  { ...base, id: 1, timestamp: ago(5 * MIN), resourceId: '100', resourceName: 'web', action: 'config_changed', fields: [f('tags', '', 'prod')] },
  // A re-creation under the same ID with many facts
  {
    ...base, id: 2, timestamp: ago(30 * MIN), resourceId: '101', resourceName: 'db', action: 'hardware_changed',
    fields: [
      f('meta', 'creation-qemu=11.0.3,ctime=1', 'creation-qemu=11.0.3,ctime=2'),
      f('name', 'old-db', 'db'),
      f('memory', '2048', '4096'),
      f('onboot', '', '1'),
      f('scsi0', 'local-lvm:vm-101-disk-0,size=10G', ''),
      f('scsi1', '', 'Ceph:vm-101-disk-1,size=32G'),
      f('description', 'a', 'b'),
      f('net0', 'e1000=AA,bridge=vmbr0', 'virtio=AA,bridge=vmbr0')
    ]
  },
  // A burst of three on one guest
  { ...base, id: 3, timestamp: ago(60 * MIN), resourceId: '102', resourceName: 'app', action: 'hardware_changed', fields: [f('memory', '2048', '4096')] },
  { ...base, id: 4, timestamp: ago(65 * MIN), resourceId: '102', resourceName: 'app', action: 'config_changed', fields: [f('cores', '1', '2')] },
  { ...base, id: 5, timestamp: ago(70 * MIN), resourceId: '102', resourceName: 'app', action: 'hardware_changed', fields: [f('memory', '1024', '2048')] },
  // A backup task
  {
    ...base, id: 6, timestamp: ago(90 * MIN), resourceId: '103', resourceName: 'files', action: 'backup', user: 'root@pam',
    taskUpid: 'UPID:pve1:0001:vzdump', taskStart: ago(96 * MIN), taskEnd: ago(90 * MIN), taskStatus: 'OK',
    fields: [f('snapshots', '', 'vzdump'), f('snapshots', 'vzdump', '')]
  },
  // A created and a deleted guest
  {
    ...base, id: 7, timestamp: ago(120 * MIN), resourceId: '104', resourceName: 'new-vm', action: 'created',
    fields: [f('name', '', 'new-vm'), f('cores', '', '2'), f('sockets', '', '2'), f('memory', '', '2048'), f('scsi0', '', 'Z:vm-104-disk-0,size=8G'), f('net0', '', 'virtio=BB,bridge=vmbr0'), f('onboot', '', '1'), f('cipassword', '', '**')]
  },
  {
    ...base, id: 8, timestamp: ago(125 * MIN), resourceId: '105', resourceName: 'gone-vm', action: 'deleted', node: 'pve2',
    fields: [f('name', 'gone-vm', ''), f('cores', '1', ''), f('memory', '512', ''), f('onboot', '1', '')]
  },
  // A container on another day, its diff only metadata
  { ...base, id: 9, timestamp: ago(3 * 24 * 60 * MIN), resourceType: 'ct', resourceId: '200', resourceName: '', action: 'config_changed', fields: [f('digest', 'a', 'b')] },
  // A node
  { ...base, id: 10, timestamp: ago(3 * 24 * 60 * MIN + MIN), resourceType: 'node', resourceId: 'pve1', resourceName: 'pve1', action: 'network_changed', fields: [f('vga', 'std', 'qxl')] }
]

const toggleRow = (name: string) => {
  fireEvent.click(screen.getAllByText(name)[0])
}

describe('ChangeJournal', () => {
  afterEach(cleanup)

  it('reads each row in one line: a fact, a summary, a size, a backup task', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} guestStatus={{ 'c1:100': 'running' }} timeline />)

    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('prod')).toBeInTheDocument()
    expect(screen.getAllByText('Re-created (same ID)').length).toBeGreaterThan(0)
    expect(screen.getByText(/7 changes/)).toBeInTheDocument()
    expect(screen.getByText('×3')).toBeInTheDocument()
    expect(screen.getByText('4 vCPU · 2 GB · 1 disk · 1 NIC')).toBeInTheDocument()
    expect(screen.getByText('1 vCPU · 512 MB')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    expect(screen.getByText('Metadata only')).toBeInTheDocument()
  })

  it('opens a change on its before/after table, by section, the raw lines folded', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} timeline />)

    toggleRow('db')

    expect(screen.getByText(/another guest|created anew/i)).toBeInTheDocument()
    expect(screen.getByText('Before')).toBeInTheDocument()
    expect(screen.getByText('After')).toBeInTheDocument()
    expect(screen.getByText('CPU and memory')).toBeInTheDocument()
    expect(screen.getByText('old-db')).toBeInTheDocument()
    expect(screen.getByText('removed')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Raw config lines (8)'))
    expect(screen.getByText('ctime=2', { exact: false })).toBeInTheDocument()
  })

  it('opens a burst on its net effect, then each change of it', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} timeline />)

    toggleRow('app')

    expect(screen.getByText('Net effect')).toBeInTheDocument()
    expect(screen.getByText('History (3)')).toBeInTheDocument()

    const history = screen.getByText('History (3)').parentElement!.parentElement!
    const subRows = within(history).getAllByRole('button')

    fireEvent.click(subRows[0])
    expect(within(history).getAllByText('Before').length).toBeGreaterThan(0)
    fireEvent.keyDown(subRows[1], { key: 'Enter' })
  })

  it('opens a backup on its task and its raw events', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} timeline />)

    toggleRow('files')

    expect(screen.getByText('vzdump task')).toBeInTheDocument()
    expect(screen.getByText('UPID:pve1:0001:vzdump')).toBeInTheDocument()

    const raw = screen.getByText('Raw events (2)').parentElement!

    fireEvent.click(raw)
    fireEvent.keyDown(raw, { key: ' ' })
  })

  it('opens a created guest on its config and a deleted one on what it was', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} timeline />)

    toggleRow('new-vm')
    expect(screen.getByText('8 GB · Z')).toBeInTheDocument()
    expect(screen.getAllByText('set').length).toBeGreaterThan(0)

    toggleRow('gone-vm')
    expect(screen.getByText('512 MB')).toBeInTheDocument()
    expect(screen.getAllByText('on').length).toBeGreaterThan(0)
  })

  it('narrows the rows by search, by the legend and back, and by a slot of the chart', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} timeline toolbar={rows => <span>{`${rows.length} kept`}</span>} />)

    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'nothing-like-this' } })
    expect(screen.getByText('No change matches these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: '' } })

    // Legend: Backups only, then all again
    fireEvent.click(within(screen.getByTestId('chart-container').parentElement!).getAllByText('Backups').at(-1)!)
    expect(screen.getByText('1 kept')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('chart-container').parentElement!).getAllByText('Backups').at(-1)!)

    // The tooltip and the bars read the buckets
    expect(within(screen.getByTestId('tooltip')).getByText('Click to filter the journal on this slot')).toBeInTheDocument()
    expect(within(screen.getByTestId('tooltip')).getByText('No changes')).toBeInTheDocument()
    expect(screen.getAllByTestId('rect').length).toBeGreaterThan(0)

    // The last day's slot, then the chip that clears it
    const slots = screen.getAllByRole('button', { name: /^slot-/ })

    fireEvent.click(slots.at(-1)!)
    expect(screen.getAllByTestId('rect').some(r => r.getAttribute('data-opacity') === '0.3')).toBe(true)
    fireEvent.click(slots.at(-1)!)
    fireEvent.click(slots.at(-1)!)
    fireEvent.click(document.querySelector('.MuiChip-deleteIcon')!)

    // An empty slot selects nothing
    fireEvent.click(slots[0])
  })

  it('switches the period of the chart', () => {
    renderWithProviders(<ChangeJournal changes={CHANGES} timeline />)

    fireEvent.click(screen.getByRole('button', { name: '24 h' }))
    expect(screen.queryByText('files')).toBeInTheDocument()
    expect(screen.queryByText('pve1', { selector: 'p' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.click(screen.getByRole('button', { name: '7 d' }))
  })

  it('pages past its first rows and drops the resource column inside a guest', () => {
    const many: JournalChange[] = Array.from({ length: 25 }, (_v, i) => ({
      ...base, id: 100 + i, timestamp: ago((i + 1) * 40 * MIN), resourceId: String(300 + i), resourceName: `vm-${i}`, action: 'config_changed', fields: [f('cores', '1', '2')]
    }))

    renderWithProviders(<ChangeJournal changes={many} />)
    expect(screen.getByText('1-20 of 25')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getByText('21-25 of 25')).toBeInTheDocument()
    cleanup()

    renderWithProviders(<ChangeJournal changes={CHANGES.slice(0, 1)} showResource={false} filters={[]} />)
    expect(screen.queryByText('Resource')).not.toBeInTheDocument()
  })
})

/**
 * The taskbar entries of bulk migrations in flight (roadmap#53): one per
 * running or paused batch, and a click reopens the follow-up, in place when an
 * Inventory page takes the request, by navigation otherwise.
 *
 * next-intl is mocked to echo the key and its values.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ batches: [] as any[], push: vi.fn() }))
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}(${JSON.stringify(values)})` : key),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }))
vi.mock('@/hooks/useActiveBulkBatches', () => ({ useActiveBulkBatches: () => ({ data: { data: h.batches } }) }))

import ActiveBulkBatchChips from './ActiveBulkBatchChips'
import { OPEN_BULK_BATCH_EVENT, type OpenBulkBatchDetail } from '@/lib/migration/bulkBatchOpen'

const batch = (over: Record<string, unknown> = {}) => ({
  id: 'b1', status: 'running', sourceConnectionId: 'vc1', sourceType: 'vcenter', total: 3,
  counts: { queued: 1, running: 1, completed: 1, failed: 0, cancelled: 0 }, ...over,
})

afterEach(() => { cleanup(); h.batches = []; h.push.mockReset() })

describe('ActiveBulkBatchChips', () => {
  it('renders nothing without a batch in flight', () => {
    h.batches = [batch({ status: 'completed' }), batch({ id: 'b2', status: 'cancelled' })]
    const { container } = render(<ActiveBulkBatchChips />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows one tab per running or paused batch with its progress', () => {
    h.batches = [batch(), batch({ id: 'b2', status: 'paused', total: 5, counts: { queued: 3, running: 0, completed: 1, failed: 1, cancelled: 0 } })]
    render(<ActiveBulkBatchChips />)
    const running = screen.getByTestId('active-bulk-batch-b1')
    expect(running).toHaveTextContent('tasks.bulkMigration({"count":3})1/3')
    expect(running).not.toHaveTextContent('tasks.bulkMigrationPaused')
    expect(running.querySelector('.ri-pause-line')).toBeNull()
    expect(screen.getByTestId('active-bulk-batch-progress-b1')).toHaveStyle({ width: '33%' })
    const paused = screen.getByTestId('active-bulk-batch-b2')
    expect(paused).toHaveTextContent('tasks.bulkMigration({"count":5})2/5tasks.bulkMigrationPaused')
    expect(paused.querySelector('.ri-pause-line')).not.toBeNull()
    expect(screen.getByTestId('active-bulk-batch-progress-b2')).toHaveStyle({ width: '40%' })
    expect(running.querySelector('img')?.getAttribute('src')).toBe('/images/esxi-logo.svg')
  })

  it('opens from the keyboard too', () => {
    h.batches = [batch()]
    render(<ActiveBulkBatchChips />)
    fireEvent.keyDown(screen.getByTestId('active-bulk-batch-b1'), { key: 'Enter' })
    expect(h.push).toHaveBeenCalledWith('/infrastructure/inventory?selectType=ext&selectId=vc1&openBatch=b1')
  })

  it('reopens in place when the Inventory page takes the request, without navigating or toggling the taskbar', () => {
    h.batches = [batch()]
    const onOpen = (e: Event) => { (e as CustomEvent<OpenBulkBatchDetail>).detail.handled = true }
    window.addEventListener(OPEN_BULK_BATCH_EVENT, onOpen)
    const toggle = vi.fn()
    try {
      render(<div onClick={toggle}><ActiveBulkBatchChips /></div>)
      fireEvent.click(screen.getByTestId('active-bulk-batch-b1'))
      expect(h.push).not.toHaveBeenCalled()
      expect(toggle).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(OPEN_BULK_BATCH_EVENT, onOpen)
    }
  })

  it('navigates to the source host with the batch when no page takes it', () => {
    h.batches = [batch()]
    render(<ActiveBulkBatchChips />)
    fireEvent.click(screen.getByTestId('active-bulk-batch-b1'))
    expect(h.push).toHaveBeenCalledWith('/infrastructure/inventory?selectType=ext&selectId=vc1&openBatch=b1')
  })
})

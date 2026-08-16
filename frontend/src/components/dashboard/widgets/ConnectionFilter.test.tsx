import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import ConnectionFilter from './ConnectionFilter'

afterEach(cleanup)

const connections = [
  { id: 'c1', name: 'cluster-1' },
  { id: 'c2', name: 'cluster-2' },
]

const t = (key: string) => key

const open = (selected: string[], onChange: (v: string[]) => void) => {
  render(<ConnectionFilter connections={connections} selected={selected} onChange={onChange} t={t} />)
  fireEvent.click(screen.getByRole('button'))
}

describe('ConnectionFilter', () => {
  it('treats an empty selection as "all connections"', () => {
    open([], vi.fn())

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]

    // The "all" entry plus one per connection, every one of them ticked.
    expect(boxes).toHaveLength(3)
    expect(boxes.every(b => b.checked)).toBe(true)
  })

  it('narrows to a single connection when one is picked from the "all" state', () => {
    const onChange = vi.fn()

    open([], onChange)
    fireEvent.click(screen.getByText('cluster-2'))

    expect(onChange).toHaveBeenCalledWith(['c2'])
  })

  it('adds a connection to an existing selection', () => {
    const onChange = vi.fn()

    open(['c1'], onChange)
    fireEvent.click(screen.getByText('cluster-2'))

    expect(onChange).toHaveBeenCalledWith(['c1', 'c2'])
  })

  it('removes a connection from a selection of several', () => {
    const onChange = vi.fn()

    open(['c1', 'c2'], onChange)
    fireEvent.click(screen.getByText('cluster-1'))

    expect(onChange).toHaveBeenCalledWith(['c2'])
  })

  it('falls back to "all" rather than an empty chart when the last one is unpicked', () => {
    const onChange = vi.fn()

    open(['c1'], onChange)
    fireEvent.click(screen.getByText('cluster-1'))

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('restores "all" from the reset entry', () => {
    const onChange = vi.fn()

    open(['c1'], onChange)
    fireEvent.click(screen.getByText('common.all'))

    expect(onChange).toHaveBeenCalledWith([])
  })
})

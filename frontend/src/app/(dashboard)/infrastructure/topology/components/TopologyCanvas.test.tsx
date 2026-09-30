import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

const { fitView } = vi.hoisted(() => ({ fitView: vi.fn() }))

vi.mock('@xyflow/react/dist/style.css', () => ({}))
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string }[] }) => (
    <div data-testid="flow">{nodes.map(n => n.id).join(',')}</div>
  ),
  Background: () => null,
  useReactFlow: () => ({ fitView }),
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

import TopologyCanvas from './TopologyCanvas'

describe('TopologyCanvas fit view', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fitView.mockReset().mockResolvedValue(true)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('fits the view 100 ms after nodes arrive', () => {
    const nodes = [{ id: 'cluster-1', type: 'cluster', position: { x: 0, y: 0 }, data: {} }]
    renderWithProviders(<TopologyCanvas nodes={nodes} edges={[]} isLoading={false} onNodeSelect={vi.fn()} />)

    expect(screen.getByTestId('flow')).toHaveTextContent('cluster-1')
    expect(fitView).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100) })
    expect(fitView).toHaveBeenCalledWith({ padding: 0.15, duration: 300, maxZoom: 1 })
  })

  it('does not fit the view with no nodes', () => {
    renderWithProviders(<TopologyCanvas nodes={[]} edges={[]} isLoading={false} onNodeSelect={vi.fn()} />)
    act(() => { vi.advanceTimersByTime(500) })
    expect(fitView).not.toHaveBeenCalled()
  })
})

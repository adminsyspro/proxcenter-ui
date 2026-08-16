import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

afterEach(cleanup)

import { SensorTemp, formatCelsius } from './SensorTemp'

const SENSORS = {
  readings: [
    { id: 'hwmon3', chip: 'k10temp', label: 'Tctl', celsius: 59.6, role: 'cpu' as const },
    { id: 'hwmon1', chip: 'nvme', label: 'Composite', celsius: 39.9, role: 'disk' as const },
    { id: 'hwmon2', chip: 'nvme', label: 'Composite', celsius: 66.5, role: 'disk' as const },
  ],
  byRole: [
    { role: 'cpu' as const, max: 59.6, count: 1 },
    { role: 'disk' as const, max: 66.5, count: 2 },
  ],
  hottest: { id: 'hwmon2', chip: 'nvme', label: 'Composite', celsius: 66.5, role: 'disk' as const },
}

describe('SensorTemp', () => {
  it('shows the reading for its own role', () => {
    renderWithProviders(<SensorTemp sensors={SENSORS} role="cpu" />)

    expect(screen.getByText('59.6 °C')).toBeInTheDocument()
  })

  it('shows the hottest sensor when a role covers several', () => {
    // Two NVMe drives at 39.9 and 66.5: the cool one must not hide the hot one.
    renderWithProviders(<SensorTemp sensors={SENSORS} role="disk" />)

    expect(screen.getByText('66.5 °C')).toBeInTheDocument()
    expect(screen.queryByText('39.9 °C')).not.toBeInTheDocument()
  })

  it('renders nothing for a role the host does not report', () => {
    const { container } = renderWithProviders(<SensorTemp sensors={SENSORS} role="memory" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without sensors, so a node with none is unchanged', () => {
    const { container: nullContainer } = renderWithProviders(<SensorTemp sensors={null} role="cpu" />)

    expect(nullContainer).toBeEmptyDOMElement()

    const { container: emptyContainer } = renderWithProviders(
      <SensorTemp sensors={{ readings: [], byRole: [], hottest: null }} role="cpu" />
    )

    expect(emptyContainer).toBeEmptyDOMElement()
  })
})

describe('formatCelsius', () => {
  it('keeps one decimal so the figure never jumps between renders', () => {
    expect(formatCelsius(59.6)).toBe('59.6 °C')
    expect(formatCelsius(40)).toBe('40.0 °C')
  })
})

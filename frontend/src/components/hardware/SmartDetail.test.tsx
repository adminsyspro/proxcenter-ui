import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, within } from '@/__tests__/setup/renderWithProviders'

afterEach(cleanup)

import SmartDetail from './SmartDetail'

const TEXT = { health: 'OK', type: 'text', text: 'Current Drive Temperature:     0 C' }
const ATTRS = {
  health: 'PASSED', type: 'ata',
  attributes: [
    { id: 5, name: 'Reallocated_Sector_Ct', value: 100, worst: 100, threshold: 10, raw: '0' },
    { id: 197, name: 'Current_Pending_Sector', value: 90, worst: 80, threshold: 95, raw: '4' },
  ],
}

// Verbatim from the user's Micron 7450 NVMe screenshot, with one deliberately
// malformed line appended to exercise the leftover path.
const NVME_TEXT = {
  health: 'OK',
  type: 'text',
  text: `SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)
Critical Warning:                   0x00
Temperature:                        40 Celsius
Available Spare:                    100%
Available Spare Threshold:          10%
Percentage Used:                    0%
Data Units Read:                    35,059,597 [17.9 TB]
Data Units Written:                 34,202,739 [17.5 TB]
Host Read Commands:                 187,639,187
Host Write Commands:                1,192,134,236
Controller Busy Time:               442
Power Cycles:                       52
This line has no colon at all`,
}

describe('SmartDetail', () => {
  it('shows a spinner while loading', () => {
    renderWithProviders(<SmartDetail smart={null} loading />)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('renders the attribute table when attributes are present', () => {
    renderWithProviders(<SmartDetail smart={ATTRS} loading={false} />)

    expect(screen.getByText('Reallocated_Sector_Ct')).toBeInTheDocument()
    expect(screen.getByText('Current_Pending_Sector')).toBeInTheDocument()
  })

  it('highlights a failing attribute', () => {
    renderWithProviders(<SmartDetail smart={ATTRS} loading={false} />)

    // value 90 <= threshold 95 is a real failure and must be visible.
    expect(screen.getByTitle('Below threshold')).toBeInTheDocument()
  })

  it('renders the raw text when there is no attribute array', () => {
    // Nominal case on virtualized disks, measured on PVE 9.1.
    renderWithProviders(<SmartDetail smart={TEXT} loading={false} />)

    expect(screen.getByText(/Current Drive Temperature/)).toBeInTheDocument()
  })

  it('says SMART is unavailable rather than showing an empty block', () => {
    renderWithProviders(<SmartDetail smart={null} loading={false} />)

    expect(screen.getByText('SMART data is not available for this disk')).toBeInTheDocument()
  })

  it('says unavailable for a payload with neither attributes nor text', () => {
    renderWithProviders(<SmartDetail smart={{ health: 'OK' }} loading={false} />)

    expect(screen.getByText('SMART data is not available for this disk')).toBeInTheDocument()
  })

  it('shows the overall health when present', () => {
    renderWithProviders(<SmartDetail smart={TEXT} loading={false} />)

    expect(screen.getByText('OK')).toBeInTheDocument()
  })

  it('does not paint an unrecognized health string as healthy', () => {
    // smartctl reports "UNKNOWN!" when it cannot determine health, and PVE
    // passes it through as-is. It must not fall into the success bucket.
    renderWithProviders(<SmartDetail smart={{ ...TEXT, health: 'UNKNOWN!' }} loading={false} />)

    const chip = screen.getByText('UNKNOWN!').closest('.MuiChip-root')

    expect(chip).toHaveClass('MuiChip-colorWarning')
  })

  it('still paints FAILED as an error and OK/PASSED as success', () => {
    renderWithProviders(<SmartDetail smart={{ ...TEXT, health: 'FAILED' }} loading={false} />)

    expect(screen.getByText('FAILED').closest('.MuiChip-root')).toHaveClass('MuiChip-colorError')

    cleanup()

    renderWithProviders(<SmartDetail smart={{ ...ATTRS, health: 'PASSED' }} loading={false} />)

    expect(screen.getByText('PASSED').closest('.MuiChip-root')).toHaveClass('MuiChip-colorSuccess')
  })

  it('renders the NVMe text as a formatted table with the section header, not a console block', () => {
    // Real Micron 7450 NVMe drives return this exact shape, measured on PVE 9.1.
    renderWithProviders(<SmartDetail smart={NVME_TEXT} loading={false} />)

    expect(screen.getByText('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)')).toBeInTheDocument()
    expect(screen.getByText('Available Spare')).toBeInTheDocument()
    expect(screen.getByText('35,059,597 [17.9 TB]')).toBeInTheDocument()
    expect(document.querySelector('pre')).not.toBeInTheDocument()
  })

  it('draws a progress bar for a percentage row with a known direction', () => {
    renderWithProviders(<SmartDetail smart={NVME_TEXT} loading={false} />)

    const row = screen.getByText('Available Spare').closest('tr')
    if (!row) throw new Error('row not found')

    const bar = within(row).getByRole('progressbar')

    expect(bar).toHaveAttribute('aria-valuenow', '100')
  })

  it('does not draw a bar for Available Spare Threshold, a reference value rather than a gauge', () => {
    renderWithProviders(<SmartDetail smart={NVME_TEXT} loading={false} />)

    const row = screen.getByText('Available Spare Threshold').closest('tr')
    if (!row) throw new Error('row not found')

    expect(within(row).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(row).getByText('10%')).toBeInTheDocument()
  })

  it('still shows an unparsed line rather than silently dropping it', () => {
    renderWithProviders(<SmartDetail smart={NVME_TEXT} loading={false} />)

    expect(screen.getByText('This line has no colon at all')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'

import { parseSmartText } from './smartText'

// Verbatim from the user's Micron 7450 NVMe screenshot. Measured on real
// hardware: PVE returns this text blob with no `attributes` array at all.
const MICRON_NVME_TEXT = `SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)
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
Power Cycles:                       52`

describe('parseSmartText', () => {
  it('returns the first line as a header, not a row', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.header).toBe('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)')
    expect(view.rows.some((r) => r.label.includes('SMART/Health'))).toBe(false)
  })

  it('turns every Label: value line into a row', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.rows).toHaveLength(11)
    expect(view.leftover).toEqual([])
  })

  it('collapses the alignment spaces between the colon and the value', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)
    const row = view.rows.find((r) => r.label === 'Critical Warning')

    expect(row?.value).toBe('0x00')
  })

  it('keeps the bracketed human-readable figure attached to its value', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)
    const row = view.rows.find((r) => r.label === 'Data Units Read')

    expect(row?.value).toBe('35,059,597 [17.9 TB]')
  })

  it('detects a genuine percentage value as a number', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.rows.find((r) => r.label === 'Available Spare')?.percent).toBe(100)
    expect(view.rows.find((r) => r.label === 'Percentage Used')?.percent).toBe(0)
  })

  it('does not treat a value that merely contains a digit as a percentage', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.rows.find((r) => r.label === 'Temperature')?.percent).toBeNull()
    expect(view.rows.find((r) => r.label === 'Data Units Read')?.percent).toBeNull()
    expect(view.rows.find((r) => r.label === 'Critical Warning')?.percent).toBeNull()
  })

  it('classifies Available Spare as higher-is-better and Percentage Used as higher-is-worse', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.rows.find((r) => r.label === 'Available Spare')?.direction).toBe('higher-is-better')
    expect(view.rows.find((r) => r.label === 'Percentage Used')?.direction).toBe('higher-is-worse')
  })

  it('defaults to unknown direction for a label it does not recognize', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.rows.find((r) => r.label === 'Power Cycles')?.direction).toBe('unknown')
  })

  it('marks Available Spare Threshold as a reference row with no bar of its own', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)
    const row = view.rows.find((r) => r.label === 'Available Spare Threshold')

    expect(row?.percent).toBe(10)
    expect(row?.isReference).toBe(true)
  })

  it('does not mark Available Spare itself as a reference row', () => {
    const view = parseSmartText(MICRON_NVME_TEXT)

    expect(view.rows.find((r) => r.label === 'Available Spare')?.isReference).toBe(false)
  })

  it('keeps a line that does not parse in the leftover list instead of dropping it', () => {
    const text = `Header line\nCritical Warning:                   0x00\nThis line has no colon at all`
    const view = parseSmartText(text)

    expect(view.rows).toHaveLength(1)
    expect(view.leftover).toEqual(['This line has no colon at all'])
  })

  it('handles an empty string', () => {
    expect(parseSmartText('')).toEqual({ header: null, rows: [], leftover: [] })
  })

  it('handles a text with only a header', () => {
    const view = parseSmartText('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)')

    expect(view.header).toBe('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)')
    expect(view.rows).toEqual([])
    expect(view.leftover).toEqual([])
  })

  it('handles a text with only a header followed by trailing blank lines', () => {
    const view = parseSmartText('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)\n\n')

    expect(view.header).toBe('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)')
    expect(view.rows).toEqual([])
    expect(view.leftover).toEqual([])
  })

  it('handles Windows line endings the same way as Unix ones', () => {
    const withCrlf = MICRON_NVME_TEXT.replace(/\n/g, '\r\n')
    const view = parseSmartText(withCrlf)

    expect(view.header).toBe('SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)')
    expect(view.rows).toHaveLength(11)
    expect(view.rows.find((r) => r.label === 'Data Units Read')?.value).toBe('35,059,597 [17.9 TB]')
    expect(view.leftover).toEqual([])
  })
})

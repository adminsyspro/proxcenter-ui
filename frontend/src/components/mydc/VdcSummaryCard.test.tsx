import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
}))

import VdcSummaryCard, { quotaTone, vdcHealth } from './VdcSummaryCard'

const vdc = (extra: Record<string, unknown> = {}) => ({
  id: 'v1',
  name: 'MSP-vDC',
  nodes: [{}, {}, {}],
  storages: [{}, {}],
  vnets: [{}, {}, {}],
  usage: { usedVcpus: 9, usedRamMb: 5504, usedStorageMb: 71684, usedVms: 5, usedBackups: 1 },
  quota: { maxVcpus: 12, maxRamMb: 6144, maxStorageMb: 51200, maxVms: 6 },
  ...extra,
})

describe('quotaTone', () => {
  it('is red only over the quota, amber from 70 %, green below, none without a quota', () => {
    expect(quotaTone(60, 50)).toBe('error')
    expect(quotaTone(50, 50)).toBe('warning')
    expect(quotaTone(7, 10)).toBe('warning')
    expect(quotaTone(6, 10)).toBe('success')
    expect(quotaTone(6, null)).toBeNull()
    expect(quotaTone(6, 0)).toBeNull()
  })
})

describe('vdcHealth', () => {
  it('takes the worst quota of the vDC', () => {
    expect(vdcHealth(['success', 'error', 'warning'])).toBe('over')
    expect(vdcHealth(['success', 'warning', null])).toBe('near')
    expect(vdcHealth(['success', null])).toBe('within')
    expect(vdcHealth([null, null])).toBe('none')
  })
})

describe('VdcSummaryCard', () => {
  afterEach(() => { cleanup() })

  it('shows each quota with its figures, the vDC state and what it holds', () => {
    render(<VdcSummaryCard vdc={vdc()} isContext={false} onOpen={() => {}} />)

    expect(screen.getByText('MSP-vDC')).toBeTruthy()
    expect(screen.getByText('myVdc.grid.health.over')).toBeTruthy()
    const meters = screen.getAllByRole('meter')
    expect(meters.map(m => m.getAttribute('aria-valuenow'))).toEqual(['9', '5504', '71684', '5'])
    expect(meters[2].parentElement?.textContent).toContain('70.0 / 50.0 GB')
    expect(screen.getByText('myVdc.grid.nodes:3')).toBeTruthy()
    expect(screen.getByText('myVdc.grid.networks:3')).toBeTruthy()
    expect(screen.getByText('myVdc.grid.backups:1')).toBeTruthy()
    expect(screen.queryByText('myVdc.currentContext')).toBeNull()
  })

  it('reads unlimited quotas as such, with the unit next to the figure', () => {
    render(<VdcSummaryCard vdc={vdc({ quota: null, description: 'Disaster recovery' })} isContext onOpen={() => {}} />)

    expect(screen.getByText('myVdc.grid.health.none')).toBeTruthy()
    expect(screen.getByText('Disaster recovery')).toBeTruthy()
    expect(screen.getByText('myVdc.currentContext')).toBeTruthy()
    const ram = screen.getAllByRole('meter')[1]
    expect(ram.getAttribute('aria-valuemax')).toBeNull()
    expect(ram.parentElement?.textContent).toContain('5.4 GB · vdc.quotaUnlimited')
  })

  it('opens the vDC on click', async () => {
    const onOpen = vi.fn()
    render(<VdcSummaryCard vdc={vdc()} isContext={false} onOpen={onOpen} />)

    await userEvent.click(screen.getByText('MSP-vDC'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})

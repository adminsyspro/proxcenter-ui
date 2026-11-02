import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'

import en from '@/messages/en.json'
import type { OutImpact } from '@/lib/ceph/osdOutImpact'
import type { CephOsd } from '@/lib/ceph/types'

import OsdActionConfirm, { type OsdActionConfirmProps } from './OsdActionConfirm'

const theme = createTheme()
const GiB = 1024 ** 3

const OSD = {
  id: 1, name: 'osd.1', host: 'pve2', status: 'up', up: true, in: true, deviceClass: 'ssd', totalBytes: 0, usedBytes: 0, availBytes: 0,
  usedPct: 82, commitLatencyMs: 2, applyLatencyMs: 2, pgs: 43, version: '20.2.4',
} as CephOsd

const LOW: OutImpact = { movedBytes: 10 * GiB, maxProjectedRatio: 0.6, maxProjectedOsd: 0, overNearfull: false, overFull: false, receivers: 2, unknown: false }
const HIGH: OutImpact = { movedBytes: 30 * GiB, maxProjectedRatio: 0.9, maxProjectedOsd: 0, overNearfull: true, overFull: false, receivers: 2, unknown: false }
const OK = { ok: true, osds: [1], numOkPgs: 43, numNotOkPgs: 0, message: null }
const REFUSED = { ok: false, osds: [1], numOkPgs: 0, numNotOkPgs: 43, message: null }
const NO_VERDICT = { ok: false, osds: [1], numOkPgs: 0, numNotOkPgs: 0, message: 'ssh failed' }

function setup(over: Partial<OsdActionConfirmProps> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <OsdActionConfirm
          action='out'
          osd={OSD}
          impact={LOW}
          okToStop={OK}
          ratios={{ nearfull: 0.85, full: 0.95 }}
          beforeRatio={0.5}
          onConfirm={onConfirm}
          onCancel={onCancel}
          {...over}
        />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )

  return { onConfirm, onCancel }
}

const confirmButton = (name: RegExp | string) => screen.getByRole('button', { name })
const typeName = (value: string) => fireEvent.change(screen.getByLabelText(en.cephCockpit.osd.confirm.typeLabel), { target: { value } })

afterEach(cleanup)

describe('OsdActionConfirm', () => {
  it('out with ok verdict and low impact confirms without typing', () => {
    const { onConfirm } = setup()

    expect(screen.queryByLabelText(en.cephCockpit.osd.confirm.typeLabel)).toBeNull()
    expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'ok')
    fireEvent.click(confirmButton('Mark out'))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('out with refused verdict requires typing osd name then sends force', () => {
    const { onConfirm } = setup({ okToStop: REFUSED })

    expect(screen.getByTestId('osd-verdict')).toHaveTextContent('43 placement groups would go offline')
    const button = confirmButton('Mark out anyway')

    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()

    typeName('osd.2')
    expect(button).toBeDisabled()
    typeName('osd.1')
    expect(button).toBeEnabled()
    fireEvent.click(button)

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('unknown verdict requires typing', () => {
    for (const okToStop of [null, NO_VERDICT]) {
      cleanup()
      const { onConfirm } = setup({ okToStop })

      expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'unknown')
      expect(confirmButton('Mark out anyway')).toBeDisabled()
      typeName('osd.1')
      fireEvent.click(confirmButton('Mark out anyway'))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
    }
  })

  it('projected over nearfull requires typing, and with an ok verdict sends no force', () => {
    const { onConfirm } = setup({ impact: HIGH })

    expect(screen.getByTestId('osd-impact')).toHaveTextContent('past nearfull')
    expect(confirmButton('Mark out anyway')).toBeDisabled()
    typeName('osd.1')
    fireEvent.click(confirmButton('Mark out anyway'))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('an unknown load requires typing and says the estimate is impossible instead of 0 B', () => {
    const { onConfirm } = setup({ impact: { movedBytes: 0, maxProjectedRatio: 0, maxProjectedOsd: null, overNearfull: false, overFull: false, receivers: 2, unknown: true } })

    expect(screen.getByTestId('osd-impact')).toHaveTextContent('Estimate impossible: the fill of osd.1')
    expect(screen.getByTestId('osd-impact')).not.toHaveTextContent('0 B')
    expect(screen.queryAllByRole('meter')).toHaveLength(0)
    expect(confirmButton('Mark out anyway')).toBeDisabled()
    typeName('osd.1')
    fireEvent.click(confirmButton('Mark out anyway'))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('accepts the name with surrounding spaces only, never a different OSD or case', () => {
    const { onConfirm } = setup({ okToStop: REFUSED })

    typeName('OSD.1')
    expect(confirmButton('Mark out anyway')).toBeDisabled()
    typeName('osd.10')
    expect(confirmButton('Mark out anyway')).toBeDisabled()
    typeName(' osd.1 ')
    expect(confirmButton('Mark out anyway')).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('submitting the form with Enter cannot skip the typed name', () => {
    const { onConfirm } = setup({ okToStop: REFUSED })

    fireEvent.submit(screen.getByTestId('osd-confirm-form'))
    expect(onConfirm).not.toHaveBeenCalled()
    typeName('osd.1')
    fireEvent.submit(screen.getByTestId('osd-confirm-form'))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('cannot confirm while the verdict is still being asked, nor while busy', () => {
    const { onConfirm } = setup({ okToStop: null, loading: true })

    expect(screen.getByTestId('osd-verdict')).toHaveAttribute('data-verdict', 'checking')
    expect(confirmButton('Mark out')).toBeDisabled()
    fireEvent.submit(screen.getByTestId('osd-confirm-form'))
    expect(onConfirm).not.toHaveBeenCalled()

    cleanup()
    const busy = setup({ busy: true })

    expect(confirmButton('Mark out')).toBeDisabled()
    fireEvent.submit(screen.getByTestId('osd-confirm-form'))
    expect(busy.onConfirm).not.toHaveBeenCalled()
  })

  it('stop and restart ask the same questions and say what the estimate means', () => {
    for (const action of ['stop', 'restart'] as const) {
      cleanup()
      const { onConfirm } = setup({ action, okToStop: REFUSED })
      const label = action === 'stop' ? 'Stop' : 'Restart'

      expect(screen.getByText(`${label} osd.1?`)).toBeInTheDocument()
      expect(screen.getByTestId('osd-impact')).toHaveTextContent('down-out delay')
      expect(confirmButton(`${label} anyway`)).toBeDisabled()
      typeName('osd.1')
      fireEvent.click(confirmButton(`${label} anyway`))
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
    }
  })

  it('stop with a safe verdict and low impact goes without typing', () => {
    const { onConfirm } = setup({ action: 'stop' })

    fireEvent.click(confirmButton('Stop'))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('says when no other OSD can take the data, and when the OSD is already out', () => {
    setup({ impact: { movedBytes: 5 * GiB, maxProjectedRatio: 1, maxProjectedOsd: null, overNearfull: true, overFull: true, receivers: 0, unknown: false } })
    expect(screen.getByTestId('osd-impact')).toHaveTextContent('No other OSD of class ssd can take this data.')

    cleanup()
    setup({ osd: { ...OSD, in: false }, impact: { movedBytes: 0, maxProjectedRatio: 0, maxProjectedOsd: null, overNearfull: false, overFull: false, receivers: 2, unknown: false } })
    expect(screen.getByTestId('osd-impact')).toHaveTextContent('osd.1 is already out: nothing moves.')
  })

  it('shows the server error and cancels', () => {
    const { onCancel } = setup({ error: 'HTTP 500' })

    expect(screen.getByRole('alert')).toHaveTextContent('The action failed: HTTP 500')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k}:${JSON.stringify(v)}` : k),
}))

import ReportBellRow from './ReportBellRow'
import type { ReportBellItem } from '@/lib/compliance/report/reportBellItems'

const READY: ReportBellItem = {
  taskId: 'report-j1',
  label: 'Rapport NIST SP 800-53',
  connectionName: 'PVE-PROD',
  status: 'done',
  downloadUrl: '/api/v1/compliance/report-jobs/j1/download',
  finishedAt: 1,
}

afterEach(cleanup)

describe('ReportBellRow', () => {
  it('announces a ready report and downloads it from the row or its button', () => {
    const onDownload = vi.fn()
    const onDismiss = vi.fn()
    render(<ReportBellRow item={READY} onDownload={onDownload} onDismiss={onDismiss} />)

    expect(screen.getByText('reportReady:{"report":"Rapport NIST SP 800-53"}')).toBeInTheDocument()
    expect(screen.getByText('PVE-PROD')).toBeInTheDocument()
    expect(screen.getByText('reportChip')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'reportDownload' }))
    fireEvent.click(screen.getByTestId('report-bell-row'))

    expect(onDownload).toHaveBeenCalledTimes(2)
    expect(onDownload).toHaveBeenCalledWith(READY)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('removes the notification without downloading', () => {
    const onDownload = vi.fn()
    const onDismiss = vi.fn()
    render(<ReportBellRow item={READY} onDownload={onDownload} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByRole('button', { name: 'reportDismiss' }))

    expect(onDismiss).toHaveBeenCalledWith(READY)
    expect(onDownload).not.toHaveBeenCalled()
  })

  it('shows why a report failed, with nothing to download', () => {
    const onDownload = vi.fn()
    render(<ReportBellRow item={{ ...READY, status: 'error', error: 'PDF generation failed', downloadUrl: undefined }} onDownload={onDownload} onDismiss={vi.fn()} />)

    expect(screen.getByText('Rapport NIST SP 800-53')).toBeInTheDocument()
    expect(screen.getByText('PDF generation failed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'reportDownload' })).toBeNull()

    fireEvent.click(screen.getByTestId('report-bell-row'))
    expect(onDownload).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the failure has no reason', () => {
    render(<ReportBellRow item={{ ...READY, status: 'error', downloadUrl: undefined }} onDownload={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByText('reportFailed')).toBeInTheDocument()
  })
})

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import { makeIncident } from './fixtures'
import IncidentReportCard from './IncidentReportCard'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('IncidentReportCard', () => {
  it('downloads the PDF under the name the route gives', async () => {
    const user = userEvent.setup()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response(new Blob(['%PDF']), { status: 200, headers: { 'Content-Disposition': 'attachment; filename="incident-x.pdf"' } }))
    renderWithProviders(<IncidentReportCard view={makeIncident({ status: 'closed' })} />)

    expect(screen.queryByText(/marks it as a draft/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Download the PDF' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/incidents/i1/report')
    expect(click).toHaveBeenCalledTimes(1)
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('incident-x.pdf')
    click.mockRestore()
  })

  it('says the report is a draft until the post-mortem is validated, and shows a failure', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }))
    renderWithProviders(<IncidentReportCard view={makeIncident()} />)

    expect(screen.getByText('The post-mortem is not validated yet: the report marks it as a draft.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Download the PDF' }))

    expect(await screen.findByText('The report could not be generated. Try again.')).toBeInTheDocument()
  })
})

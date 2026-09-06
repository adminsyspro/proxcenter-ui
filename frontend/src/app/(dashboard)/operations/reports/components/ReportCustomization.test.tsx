import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
  within,
} from '@/__tests__/setup/renderWithProviders'
import { DEFAULT_REPORT_TEMPLATE, type ReportTemplateSettings } from '@/lib/reports/templateSettings'

const h = vi.hoisted(() => ({ showToast: vi.fn() }))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: h.showToast }),
}))

vi.mock('@/contexts/BrandingContext', () => ({
  useBranding: () => ({
    branding: { enabled: true, primaryColor: '#112233' },
    loading: false,
    refresh: vi.fn(),
  }),
}))

import ReportCustomization from './ReportCustomization'

const SETTINGS_URL = '/api/v1/settings/reports-template'
const PREVIEW_URL = '/api/v1/orchestrator/reports/preview'
const PREVIEW_SRC = 'blob:mock-1#navpanes=0&view=FitH'
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
]

const STORED: ReportTemplateSettings = {
  ...DEFAULT_REPORT_TEMPLATE,
  pageSize: 'Letter',
  orientation: 'landscape',
  footerText: 'Internal',
  coverSubtitle: 'Monthly review',
}

type PreviewBody = { language: string; template: ReportTemplateSettings }

let getFails = false
let putFails = false
let previewFails = false
let putBodies: ReportTemplateSettings[] = []
let previewBodies: PreviewBody[] = []
let createObjectURLMock: ReturnType<typeof vi.fn>
let revokeObjectURLMock: ReturnType<typeof vi.fn>
let openMock: ReturnType<typeof vi.fn>

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

beforeEach(() => {
  getFails = false
  putFails = false
  previewFails = false
  putBodies = []
  previewBodies = []
  h.showToast.mockClear()

  createObjectURLMock = vi.fn(() => 'blob:mock-1')
  revokeObjectURLMock = vi.fn()
  URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL

  openMock = vi.fn(() => null)
  vi.stubGlobal('open', openMock)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'

      if (url === SETTINGS_URL && method === 'GET') {
        return getFails ? jsonResponse({ error: 'nope' }, 500) : jsonResponse(STORED)
      }

      if (url === SETTINGS_URL && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as ReportTemplateSettings

        putBodies.push(body)

        return putFails ? jsonResponse({ error: 'db down' }, 500) : jsonResponse({ success: true, ...body })
      }

      if (url === PREVIEW_URL && method === 'POST') {
        previewBodies.push(JSON.parse(String(init?.body)) as PreviewBody)

        return previewFails
          ? jsonResponse({ error: 'boom' }, 400)
          : new Response(new Blob(['%PDF-1.7 x'], { type: 'application/pdf' }), { status: 200 })
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`)
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()

  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL
  else delete (URL as unknown as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL

  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL
  else delete (URL as unknown as { revokeObjectURL?: typeof URL.revokeObjectURL }).revokeObjectURL
})

const renderLoaded = async () => {
  const result = renderWithProviders(<ReportCustomization languages={LANGUAGES} />)

  await waitFor(() => expect(screen.getByLabelText('Cover subtitle')).toBeInTheDocument())

  return result
}

const replaceText = async (label: string, value: string) => {
  const field = screen.getByLabelText(label)

  await userEvent.clear(field)
  if (value) await userEvent.type(field, value)
}

// MUI Select: open the combobox, then pick the option by its text.
const pickOption = async (comboboxName: string, optionText: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: comboboxName }))
  await userEvent.click(await screen.findByRole('option', { name: optionText }))
}

describe('ReportCustomization', () => {
  it('loads the stored text settings without marking the template as dirty', async () => {
    await renderLoaded()

    expect(screen.getByLabelText('Cover subtitle')).toHaveValue('Monthly review')
    expect(screen.getByLabelText('Classification mention')).toHaveValue('Internal')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('shows the server error instead of the form when loading fails', async () => {
    getFails = true
    renderWithProviders(<ReportCustomization languages={LANGUAGES} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
    expect(screen.queryByLabelText('Cover subtitle')).not.toBeInTheDocument()
  })

  it('renders an initial English preview from the stored template', async () => {
    await renderLoaded()
    expect(screen.getByText('Rendering preview...')).toBeInTheDocument()

    await waitFor(
      () => {
        expect(previewBodies).toHaveLength(1)
        expect(document.querySelector('iframe[title="Preview"]')).toHaveAttribute('src', PREVIEW_SRC)
      },
      { timeout: 4000 },
    )

    expect(previewBodies[0].language).toBe('en')
    expect(previewBodies[0].template.pageSize).toBe('Letter')
    expect(previewBodies[0].template.orientation).toBe('landscape')
    expect(createObjectURLMock).toHaveBeenCalledOnce()
  })

  it('saves an edited cover subtitle and clears the dirty state', async () => {
    await renderLoaded()
    await replaceText('Cover subtitle', 'Quarterly')

    const save = screen.getByRole('button', { name: 'Save' })

    expect(save).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    await userEvent.click(save)

    await waitFor(() => expect(putBodies).toHaveLength(1))
    expect(putBodies[0]).toMatchObject({ coverSubtitle: 'Quarterly', pageSize: 'Letter' })
    expect(h.showToast).toHaveBeenCalledWith('Report template saved', 'success')
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('keeps the draft dirty and reports the error when saving fails', async () => {
    putFails = true
    await renderLoaded()
    await replaceText('Cover subtitle', 'Quarterly')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(h.showToast).toHaveBeenCalledWith('db down', 'error'))
    expect(putBodies).toHaveLength(1)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('rejects an imported stylesheet and does not preview it', async () => {
    await renderLoaded()
    await userEvent.type(screen.getByLabelText('Custom CSS'), '@import url(http://x)')

    expect(screen.getByText('@import is not allowed. Inline the rules instead.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    const previewCount = previewBodies.length

    await new Promise(resolve => setTimeout(resolve, 1600))
    expect(previewBodies).toHaveLength(previewCount)
  })

  it('validates the primary colour and permits returning to no override', async () => {
    await renderLoaded()
    await userEvent.type(screen.getByLabelText('Primary colour'), 'zzz')

    expect(screen.getByText('Enter a hex colour such as #003366, or leave the field empty.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await userEvent.clear(screen.getByLabelText('Primary colour'))
    expect(screen.queryByText('Enter a hex colour such as #003366, or leave the field empty.')).not.toBeInTheDocument()
  })

  it('resets the stored template to dirty defaults', async () => {
    await renderLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))

    expect(screen.getByLabelText('Classification mention')).toHaveValue('Confidential')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('shows a preview error without rendering an iframe', async () => {
    previewFails = true
    await renderLoaded()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('boom'), { timeout: 4000 })
    expect(document.querySelector('iframe[title="Preview"]')).not.toBeInTheDocument()
  })

  it('refreshes the preview and opens it in a new tab', async () => {
    await renderLoaded()
    await waitFor(() => expect(previewBodies).toHaveLength(1), { timeout: 4000 })

    const refresh = within(screen.getByLabelText('Refresh preview')).getByRole('button')

    await waitFor(() => expect(refresh).toBeEnabled())
    await userEvent.click(refresh)
    await waitFor(() => expect(previewBodies).toHaveLength(2), { timeout: 4000 })
    await waitFor(() => expect(revokeObjectURLMock).toHaveBeenCalledOnce())

    const open = within(screen.getByLabelText('Open in a new tab')).getByRole('button')

    await waitFor(() => expect(open).toBeEnabled())
    await userEvent.click(open)
    expect(openMock).toHaveBeenCalledWith(PREVIEW_SRC, '_blank', 'noopener')
  })

  it('previews a page-number toggle from the current draft', async () => {
    await renderLoaded()
    const pageNumbers = screen.getByLabelText('Show page numbers')

    expect(pageNumbers).toBeChecked()
    await userEvent.click(pageNumbers)
    expect(pageNumbers).not.toBeChecked()

    await waitFor(
      () => expect(previewBodies.some(body => body.template.showPageNumbers === false)).toBe(true),
      { timeout: 4000 },
    )
  })

  it('previews the layout selects from the current draft', async () => {
    await renderLoaded()
    await waitFor(() => expect(previewBodies).toHaveLength(1), { timeout: 4000 })

    await pickOption('Paper size', 'A4')
    await pickOption('Orientation', 'Portrait')
    await pickOption('Font', 'Serif')
    await pickOption('Base font size', '11 pt')

    expect(screen.getByRole('combobox', { name: 'Paper size' })).toHaveTextContent('A4')
    expect(screen.getByRole('combobox', { name: 'Orientation' })).toHaveTextContent('Portrait')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    await waitFor(
      () => {
        const last = previewBodies[previewBodies.length - 1]

        expect(last.template).toMatchObject({ pageSize: 'A4', orientation: 'portrait', fontFamily: 'serif', baseFontSize: 11 })
      },
      { timeout: 4000 },
    )
  })

  it('re-renders the preview in the language picked in the preview pane', async () => {
    await renderLoaded()
    await waitFor(() => expect(previewBodies).toHaveLength(1), { timeout: 4000 })

    await pickOption('Language', 'Français')

    await waitFor(() => expect(previewBodies.some(body => body.language === 'fr')).toBe(true), { timeout: 4000 })
    // Changing the preview language is not a template change.
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('revokes the exact object URL it created when unmounted', async () => {
    const { unmount } = await renderLoaded()

    await waitFor(() => expect(createObjectURLMock).toHaveBeenCalledOnce(), { timeout: 4000 })
    unmount()

    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-1')
  })

  it('updates the remaining text, colour, and logo controls', async () => {
    await renderLoaded()

    await replaceText('Primary colour', '#abcdef')
    await userEvent.click(screen.getByLabelText('Show the logo on the cover'))
    await replaceText('Cover note', 'For the board')
    await replaceText('Running header', 'Board report')

    expect(screen.getByLabelText('Primary colour')).toHaveValue('#abcdef')
    expect(screen.getByLabelText('Show the logo on the cover')).not.toBeChecked()
    expect(screen.getByLabelText('Cover note')).toHaveValue('For the board')
    expect(screen.getByLabelText('Running header')).toHaveValue('Board report')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })
})

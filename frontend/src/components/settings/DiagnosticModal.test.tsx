/**
 * Component tests for DiagnosticModal.tsx
 *
 * Strategy: render the dialog, seed the single MSW endpoint it fires on open
 * (GET /api/v1/connections/:id/diagnostics), await data, then assert visible
 * output and interactions.
 *
 * No context mocks needed: the component only calls useTranslations, which the
 * renderWithProviders harness satisfies via the real en.json.
 *
 * Dialog renders into a MUI portal; use screen.* (not within(container)).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { diagResultFixture } from '@/__tests__/fixtures/diagnostics'

import DiagnosticModal from './DiagnosticModal'

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONN_ID = 'conn-1'
const CONN_NAME = 'pve-cluster-test'

// ------------------------------------------------------------------ //
// Helper: default props
// ------------------------------------------------------------------ //

function makeProps(
  overrides: Partial<Parameters<typeof DiagnosticModal>[0]> = {},
) {
  return {
    open: true,
    connectionId: CONN_ID,
    connectionName: CONN_NAME,
    onClose: vi.fn(),
    ...overrides,
  }
}

// ------------------------------------------------------------------ //
// MSW handler factory
// Seeds the diagnostics endpoint for the happy path.
// ------------------------------------------------------------------ //

function seedDiagnosticsOk() {
  server.use(
    http.get(`*/api/v1/connections/${CONN_ID}/diagnostics`, () =>
      HttpResponse.json(diagResultFixture),
    ),
  )
}

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// 1. Closed state
// ------------------------------------------------------------------ //

describe('DiagnosticModal - closed state', () => {
  it('does not render dialog content when open=false', () => {
    renderWithProviders(
      <DiagnosticModal {...makeProps({ open: false, connectionId: CONN_ID })} />,
    )
    // The dialog title only appears when the Dialog is open.
    expect(screen.queryByText('Connection diagnostics')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 2. Happy path: title + connectionName + fetch-driven check data
// ------------------------------------------------------------------ //

describe('DiagnosticModal - success path', () => {
  beforeEach(() => {
    seedDiagnosticsOk()
  })

  it('shows the dialog title and connectionName when open=true', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    // Title comes from t('title') = "Connection diagnostics".
    expect(screen.getByText('Connection diagnostics')).toBeInTheDocument()
    // connectionName caption is rendered below the title.
    expect(screen.getByText(CONN_NAME)).toBeInTheDocument()
  })

  it('renders check labels from the fixture after fetch resolves', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    // "Host reachable" is the ok-check label from the fixture, not static text.
    expect(await screen.findByText('Host reachable')).toBeInTheDocument()
    // "API token valid" is the warn-check label from the fixture.
    expect(screen.getByText('API token valid')).toBeInTheDocument()
  })

  it('renders the category headers from the fixture (network + auth)', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('Host reachable')
    // Category headers are rendered as overline Typography with the raw category string.
    expect(screen.getByText('network')).toBeInTheDocument()
    expect(screen.getByText('auth')).toBeInTheDocument()
  })

  it('renders check messages from the fixture', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('Host reachable')
    expect(screen.getByText('TCP connect succeeded')).toBeInTheDocument()
    expect(screen.getByText('Token expires soon')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 3. Status rendering: ok chip + warn chip both surface from fixture
// ------------------------------------------------------------------ //

describe('DiagnosticModal - summary chips', () => {
  beforeEach(() => {
    seedDiagnosticsOk()
  })

  it('renders the ok summary chip with count from fixture (1 OK)', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('Host reachable')
    // t('summaryOk', { count: 1 }) = "1 OK"
    expect(screen.getByText('1 OK')).toBeInTheDocument()
  })

  it('renders the warn summary chip with count from fixture (1 warning)', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('Host reachable')
    // t('summaryWarn', { count: 1 }) = "1 warning"
    expect(screen.getByText('1 warning')).toBeInTheDocument()
  })

  it('does NOT render error or skip chips when fixture has none', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('Host reachable')
    // fixture.summary.error=0 and fixture.summary.skip=0
    expect(screen.queryByText(/\d+ error/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ skipped/)).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 4. Detail expand/collapse for warn check
// ------------------------------------------------------------------ //

describe('DiagnosticModal - detail expansion', () => {
  beforeEach(() => {
    seedDiagnosticsOk()
  })

  it('shows "Show detail" button for a check that has a detail field', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('API token valid')
    // The warn check has detail="Expires in 3 days"; the component renders a toggle button.
    expect(screen.getByRole('button', { name: /show detail/i })).toBeInTheDocument()
  })

  it('clicking Show detail reveals the detail text, clicking Hide detail collapses it', async () => {
    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText('API token valid')

    const showBtn = screen.getByRole('button', { name: /show detail/i })
    fireEvent.click(showBtn)

    // After expanding, the detail text from the fixture is visible.
    expect(await screen.findByText('Expires in 3 days')).toBeInTheDocument()
    // Button label has changed to "Hide detail".
    expect(screen.getByRole('button', { name: /hide detail/i })).toBeInTheDocument()

    // Collapse it again.
    fireEvent.click(screen.getByRole('button', { name: /hide detail/i }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /hide detail/i })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /show detail/i })).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 5. Error path: 500 response renders the error alert
// ------------------------------------------------------------------ //

describe('DiagnosticModal - error path', () => {
  it('renders the error alert when the endpoint returns 500', async () => {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/diagnostics`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )

    renderWithProviders(<DiagnosticModal {...makeProps()} />)

    // t('unavailable') = "Diagnostics unavailable"; the component appends ": {msg}".
    expect(
      await screen.findByText(/Diagnostics unavailable/),
    ).toBeInTheDocument()
    // The error message from the JSON body must also appear.
    expect(screen.getByText(/boom/)).toBeInTheDocument()
  })

  it('does not render check data on error', async () => {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/diagnostics`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 500 }),
      ),
    )

    renderWithProviders(<DiagnosticModal {...makeProps()} />)
    await screen.findByText(/Diagnostics unavailable/)

    // No check labels from the fixture should appear.
    expect(screen.queryByText('Host reachable')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 6. null connectionId: fetch does NOT fire, modal renders clean
// ------------------------------------------------------------------ //

describe('DiagnosticModal - null connectionId', () => {
  // No MSW handler seeded. If a request fires, MSW will error (onUnhandledRequest:'error').

  it('renders the dialog title without firing diagnostics when connectionId=null', () => {
    renderWithProviders(
      <DiagnosticModal
        {...makeProps({ connectionId: null })}
      />,
    )
    // Dialog is open: title is visible.
    expect(screen.getByText('Connection diagnostics')).toBeInTheDocument()
    // No check data from fixture should ever appear (no fetch ran).
    expect(screen.queryByText('Host reachable')).not.toBeInTheDocument()
  })

  it('Re-run button is disabled when connectionId=null', () => {
    renderWithProviders(
      <DiagnosticModal {...makeProps({ connectionId: null })} />,
    )
    const rerunBtn = screen.getByRole('button', { name: /re-run/i })
    expect(rerunBtn).toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// 7. Close button
// ------------------------------------------------------------------ //

describe('DiagnosticModal - close button', () => {
  beforeEach(() => {
    seedDiagnosticsOk()
  })

  it('calls onClose when the Close button in DialogActions is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<DiagnosticModal {...makeProps({ onClose })} />)

    // t('close') = "Close" -- the contained button in DialogActions.
    const closeBtn = screen.getByRole('button', { name: 'Close' })
    fireEvent.click(closeBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the X icon button in the title is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<DiagnosticModal {...makeProps({ onClose })} />)

    // The close IconButton in DialogTitle wraps an icon with no visible text;
    // it is the only button with empty text content.
    const allButtons = screen.getAllByRole('button')
    const iconBtns = allButtons.filter(b => !b.textContent?.trim())
    // There is exactly one icon-only button: the X in the title.
    expect(iconBtns).toHaveLength(1)
    fireEvent.click(iconBtns[0])

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

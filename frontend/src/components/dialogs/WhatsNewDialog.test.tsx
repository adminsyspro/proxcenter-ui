import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import WhatsNewDialog, { useWhatsNew } from './WhatsNewDialog'
import changelog from '@/data/changelog.json'

const STORAGE_KEY = 'proxcenter_whats_new_seen'

// Cast to get typed access; the real data shape is version/title/items.
const latestVersion = (changelog as { version: string }[])[0].version

// ---------------------------------------------------------------------------
// localStorage isolation: clear before each test, restore after.
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

// ---------------------------------------------------------------------------
// useWhatsNew hook
// ---------------------------------------------------------------------------
describe('useWhatsNew hook', () => {
  it('reports hasUnseen=true and open=false when localStorage is empty', () => {
    // No previous value in localStorage => latest version not seen yet.
    const { result } = renderHook(() => useWhatsNew())

    expect(result.current.open).toBe(false)
    expect(result.current.hasUnseen).toBe(true)
  })

  it('opens the dialog when handleOpen is called', () => {
    const { result } = renderHook(() => useWhatsNew())

    act(() => {
      result.current.handleOpen()
    })

    expect(result.current.open).toBe(true)
  })

  it('closes the dialog, marks seen in localStorage, and clears hasUnseen on handleClose', () => {
    const { result } = renderHook(() => useWhatsNew())

    // Open first so there is something to close.
    act(() => {
      result.current.handleOpen()
    })
    expect(result.current.open).toBe(true)

    act(() => {
      result.current.handleClose()
    })

    expect(result.current.open).toBe(false)
    expect(result.current.hasUnseen).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe(latestVersion)
  })

  it('reports hasUnseen=false when localStorage already holds the latest version', () => {
    // Simulate a returning user who has already seen this version.
    localStorage.setItem(STORAGE_KEY, latestVersion)

    const { result } = renderHook(() => useWhatsNew())

    expect(result.current.hasUnseen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// WhatsNewDialog component
// ---------------------------------------------------------------------------
describe('WhatsNewDialog component', () => {
  it('renders the dialog title and latest version chip when open=true', () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    // The dialog title key renders to "What's New" via real en.json messages.
    expect(screen.getByText("What's New")).toBeInTheDocument()

    // The latest changelog version chip must be visible.
    expect(screen.getByText(latestVersion)).toBeInTheDocument()
  })

  it('hides dialog from accessibility tree after transition to open=false', () => {
    // NOTE: WhatsNewDialog keeps its subtree mounted even when rendered with
    // open=false from the start (it uses MUI keepMounted or an equivalent
    // pattern). The fresh-render content-absence strategy therefore does not
    // apply here. Closure is verified via the aria-hidden="true" attribute that
    // MUI places on the MuiModal-root, which removes the whole dialog from the
    // accessibility tree while leaving the DOM nodes present.
    const { rerender } = renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)
    // When open, the accessible dialog is present.
    const dialogEl = screen.getByRole('dialog')
    expect(dialogEl).toBeInTheDocument()
    // Find the portal container: the body-level div that MUI injects to host
    // the dialog portal. This parent is stable across rerenders.
    const modalRoot = dialogEl.closest('.MuiModal-root') as Element
    expect(modalRoot).not.toBeNull()
    const portalContainer = modalRoot.parentElement as Element
    expect(portalContainer).not.toBeNull()
    // The wrapper for this open dialog must not be aria-hidden.
    expect(modalRoot.getAttribute('aria-hidden')).toBeNull()

    rerender(<WhatsNewDialog open={false} onClose={vi.fn()} />)
    // After closing, MUI marks the modal root aria-hidden="true". Re-query
    // from the stable portal container to get the current (possibly new) node.
    const modalRootAfter = portalContainer.querySelector('.MuiModal-root') as Element
    expect(modalRootAfter).not.toBeNull()
    expect(modalRootAfter.getAttribute('aria-hidden')).toBe('true')
  })

  it('calls onClose when the close IconButton is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<WhatsNewDialog open={true} onClose={onClose} />)

    // There are two close triggers: the IconButton (ri-close-line) and the
    // "Close" button in DialogActions. Click the first button that is
    // accessible via its role - the IconButton sibling to the title.
    // userEvent.click on ANY close trigger should fire onClose.
    const buttons = screen.getAllByRole('button')
    // The IconButton with the X icon is the first button (before "Close").
    await userEvent.click(buttons[0])

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when the "Close" action button is clicked', async () => {
    const onClose = vi.fn()
    renderWithProviders(<WhatsNewDialog open={true} onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows at least the first changelog entry title in the expanded accordion', () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    // The first entry is expanded by default; its title must be visible.
    // Use getAllByText and assert at least one match is in the document,
    // since jsdom may duplicate portal nodes across renders in the same suite.
    const firstTitle = (changelog as { version: string; title: string }[])[0].title
    const matches = screen.getAllByText(firstTitle)
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})

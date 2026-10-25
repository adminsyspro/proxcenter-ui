import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import WhatsNewDialog, { useWhatsNew } from './WhatsNewDialog'
import changelog from '@/data/changelog.json'

// Branding is read from context; each case sets what the instance is branded with.
const branding = vi.hoisted(() => ({ current: { enabled: false, changelogUrl: '' } }))
vi.mock('@/contexts/BrandingContext', () => ({ useBranding: () => ({ branding: branding.current }) }))

const STORAGE_KEY = 'proxcenter_whats_new_seen'

// Cast to get typed access; the real data shape is version/title/items.
const latestVersion = (changelog as { version: string }[])[0].version

// ---------------------------------------------------------------------------
// localStorage isolation: clear before each test, restore after.
// ---------------------------------------------------------------------------
beforeEach(() => {
  localStorage.clear()
  branding.current = { enabled: false, changelogUrl: '' }
})

afterEach(() => {
  // No RTL auto-cleanup here (vitest runs without globals): a dialog left
  // mounted past its case keeps its MUI exit transition timer alive, and that
  // timer fires once the jsdom window is gone, as an unhandled
  // "window is not defined" that fails the whole CI run with every test green.
  cleanup()
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

  it('removes the dialog once the close transition has run after open=false', async () => {
    // The Dialog is not keepMounted: once its exit transition ends, MUI
    // unmounts the portal. MUI never marks a closing modal's own root
    // aria-hidden (only the siblings of an open one), so the absence of the
    // dialog role is the observable end state.
    const { rerender } = renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    rerender(<WhatsNewDialog open={false} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
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

  it('shows the latest release summary as prose, not as its item list', () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    const latest = (changelog as { summary?: string[]; items: { text: string }[] }[])[0]
    expect(latest.summary?.length).toBeGreaterThan(0)
    for (const paragraph of latest.summary ?? []) {
      expect(screen.getByText(paragraph)).toBeInTheDocument()
    }
    expect(screen.queryByText(latest.items[0].text)).toBeNull()
  })

  it('keeps previous releases collapsed until their row opens on their summary', async () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    const previous = (changelog as { title: string; summary?: string[]; items: { text: string }[] }[])[1]
    const summary = screen.getByText(previous.title).closest('[aria-expanded]') as HTMLElement
    expect(summary).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(summary)

    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(previous.summary![0])).toBeInTheDocument()
    expect(screen.queryByText(previous.items[0].text)).toBeNull()
  })

  it('lists only the five releases before the latest one', () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    const entries = changelog as { title: string }[]
    for (const entry of entries.slice(1, 6)) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
    }
    for (const entry of entries.slice(6)) {
      expect(screen.queryByText(entry.title)).toBeNull()
    }
  })

  it('gives every listed release a prose summary', () => {
    for (const entry of (changelog as { version: string; summary?: string[] }[]).slice(0, 6)) {
      expect(entry.summary?.length, entry.version).toBeGreaterThan(0)
    }
  })

  it('shows the upgrade command and copies it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} canUpgrade />)

    const command = 'docker compose pull && docker compose up -d'
    expect(screen.getByText(command)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(command)
  })

  it('hides the upgrade command from viewers who cannot upgrade the instance', () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    expect(screen.queryByText('docker compose pull && docker compose up -d')).toBeNull()
  })

  it('announces a newer version and marks the shown release as installed', () => {
    const updateInfo = { updateAvailable: true, latestVersion: '9.9.9', releaseUrl: 'https://example.test/v9.9.9' }
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} canUpgrade updateInfo={updateInfo} />)

    expect(screen.getByText('Installed')).toBeInTheDocument()
    expect(screen.queryByText('Latest')).toBeNull()
    expect(screen.getByText(/v9\.9\.9/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View Release' })).toHaveAttribute('href', updateInfo.releaseUrl)
  })

  it('labels the shown release as the latest when no update is pending', () => {
    const updateInfo = { updateAvailable: false, latestVersion: latestVersion, releaseUrl: null }
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} canUpgrade updateInfo={updateInfo} />)

    expect(screen.getByText('Latest')).toBeInTheDocument()
    expect(screen.getByText('Upgrade')).toBeInTheDocument()
  })

  it('replaces the pull command with the air-gapped notice on an offline instance', () => {
    const updateInfo = { updateAvailable: false, latestVersion: null, releaseUrl: null, error: 'offline' }
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} canUpgrade updateInfo={updateInfo} />)

    expect(screen.getByText(/disabled on this air-gapped instance/)).toBeInTheDocument()
    expect(screen.queryByText('docker compose pull && docker compose up -d')).toBeNull()
  })

  it('points a white-labelled instance at its own changelog', () => {
    branding.current = { enabled: true, changelogUrl: 'https://brand.example/changelog' }
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: /All releases/ })).toHaveAttribute('href', 'https://brand.example/changelog')
    expect(screen.queryByText('All releases on GitHub')).toBeNull()
  })

  it('links to the GitHub releases page in a new tab', () => {
    renderWithProviders(<WhatsNewDialog open={true} onClose={vi.fn()} />)

    const link = screen.getByRole('link', { name: /All releases on GitHub/ })
    expect(link).toHaveAttribute('href', 'https://github.com/adminsyspro/proxcenter-ui/releases')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

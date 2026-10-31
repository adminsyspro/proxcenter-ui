import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { useTranslations } from 'next-intl'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import { COLORS } from '../../constants'
import { AiPending, Conclusion, EmptyState, PagedTable, SectionCard, UsageBar, focusRowSx, formatDays, usageColor } from './ui'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const RED = 'rgb(239, 68, 68)'
const ORANGE = 'rgb(245, 158, 11)'

describe('usageColor', () => {
  it('turns orange at the warning threshold and red at the critical one', () => {
    expect(usageColor(50, 80, 90)).toBe(COLORS.success)
    expect(usageColor(80, 80, 90)).toBe(COLORS.warning)
    expect(usageColor(89.9, 80, 90)).toBe(COLORS.warning)
    expect(usageColor(90, 80, 90)).toBe(COLORS.error)
  })
})

describe('UsageBar', () => {
  it('shows the rounded figure in the neutral colour below the warning threshold', () => {
    renderWithProviders(<UsageBar pct={42.6} warning={80} critical={90} />)

    const figure = screen.getByText('43%')

    expect(figure).not.toHaveStyle({ color: ORANGE })
    expect(figure).not.toHaveStyle({ color: RED })
  })

  it('colours the figure once a threshold is passed', () => {
    const { rerender } = renderWithProviders(<UsageBar pct={85} warning={80} critical={90} />)

    expect(screen.getByText('85%')).toHaveStyle({ color: ORANGE })

    rerender(<UsageBar pct={95} warning={80} critical={90} />)
    expect(screen.getByText('95%')).toHaveStyle({ color: RED })
  })

  it('clamps the gauge fill to the track while keeping the real figure', () => {
    const { container } = renderWithProviders(<UsageBar pct={140} warning={80} critical={90} />)

    expect(screen.getByText('140%')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toHaveStyle({ width: '100%' })
  })
})

describe('SectionCard', () => {
  it('shows the title, subtitle, action and body, with no fold control by default', () => {
    const { container } = renderWithProviders(
      <SectionCard id="anchor" icon="ri-test" title="Title" subtitle="Sub" action={<span>Act</span>}>
        <p>Body</p>
      </SectionCard>,
    )

    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.getByText('Sub')).toBeInTheDocument()
    expect(screen.getByText('Act')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('#anchor')).not.toBeNull()
  })

  it('folds: the header and the arrow each toggle once, and a closed card hides its body', async () => {
    const onToggle = vi.fn()
    const { rerender } = renderWithProviders(
      <SectionCard icon="ri-test" title="Title" open onToggle={onToggle}><p>Body</p></SectionCard>,
    )

    const arrow = screen.getByRole('button', { name: 'Collapse' })

    expect(arrow).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(arrow)
    expect(onToggle).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Title'))
    expect(onToggle).toHaveBeenCalledTimes(2)

    rerender(<SectionCard icon="ri-test" title="Title" open={false} onToggle={onToggle}><p>Body</p></SectionCard>)
    expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute('aria-expanded', 'false')
    // The body leaves once the fold transition ends.
    await waitFor(() => expect(screen.queryByText('Body')).toBeNull())
  })

  it('renders without a subtitle in flush and fill layouts', () => {
    renderWithProviders(<SectionCard icon="ri-test" title="Only title" flush fill><p>Body</p></SectionCard>)

    expect(screen.getByText('Only title')).toBeInTheDocument()
    expect(screen.getByText('Body')).toBeInTheDocument()
  })
})

describe('focusRowSx', () => {
  it('animates only the focused row', () => {
    expect(focusRowSx(true)).toMatchObject({ animation: 'cockpitFocus 2.4s ease-out' })
    expect(focusRowSx(false)).toEqual({})
  })
})

describe('PagedTable', () => {
  const items = Array.from({ length: 25 }, (_, i) => `row-${i + 1}`)
  const list = (rows: string[]) => <ul>{rows.map(r => <li key={r}>{r}</li>)}</ul>

  it('hands every row at once and shows no pager for a short list', () => {
    renderWithProviders(<PagedTable items={items.slice(0, 5)}>{list}</PagedTable>)

    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByText('Rows per page')).toBeNull()
  })

  it('pages a long list and moves between pages', () => {
    renderWithProviders(<PagedTable items={items}>{list}</PagedTable>)

    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    expect(screen.getByText('Rows per page')).toBeInTheDocument()
    expect(screen.queryByText('row-21')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('row-25')).toBeInTheDocument()
  })

  it('goes back to the first page when the page size changes', () => {
    renderWithProviders(<PagedTable items={items}>{list}</PagedTable>)

    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(screen.getByRole('option', { name: '50' }))

    expect(screen.getAllByRole('listitem')).toHaveLength(25)
    expect(screen.getByText('row-1')).toBeInTheDocument()
  })

  it('turns to the page of a newly focused row, once per focus', () => {
    const { rerender } = renderWithProviders(<PagedTable items={items}>{list}</PagedTable>)

    rerender(<PagedTable items={items} focusIndex={22} focusNonce={1}>{list}</PagedTable>)
    expect(screen.getByText('row-23')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /previous page/i }))
    expect(screen.getByText('row-1')).toBeInTheDocument()

    // Same nonce: the user's own paging wins.
    rerender(<PagedTable items={items} focusIndex={22} focusNonce={1}>{list}</PagedTable>)
    expect(screen.getByText('row-1')).toBeInTheDocument()

    // A focus that matches no row leaves the page alone.
    rerender(<PagedTable items={items} focusIndex={-1} focusNonce={2}>{list}</PagedTable>)
    expect(screen.getByText('row-1')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('shows its sentence', () => {
    renderWithProviders(<EmptyState icon="ri-test" text="Nothing here" />)

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})

function Days({ days }: { days: number | null | undefined }) {
  const t = useTranslations()

  return <span>{formatDays(t, days)}</span>
}

describe('formatDays', () => {
  it('says beyond the horizon, crossed, or the number of days', () => {
    const { rerender } = renderWithProviders(<Days days={null} />)

    expect(screen.getByText('> 1 year')).toBeInTheDocument()
    rerender(<Days days={undefined} />)
    expect(screen.getByText('> 1 year')).toBeInTheDocument()
    rerender(<Days days={0} />)
    expect(screen.getByText('Exceeded')).toBeInTheDocument()
    rerender(<Days days={12} />)
    expect(screen.getByText('12 d')).toBeInTheDocument()
  })
})

describe('AiPending', () => {
  it('shows a busy status and the elapsed time from the third second', () => {
    vi.useFakeTimers()
    renderWithProviders(<AiPending title="Reading" hint="Takes a while" testId="pending" />)

    const status = screen.getByTestId('pending')

    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Reading')).toBeInTheDocument()
    expect(screen.getByText('Takes a while')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.queryByText(/s elapsed/)).toBeNull()

    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('3 s elapsed')).toBeInTheDocument()
  })

  it('stops its timer on unmount', () => {
    vi.useFakeTimers()
    const clear = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderWithProviders(<AiPending title="Reading" hint="Hint" />)

    unmount()
    expect(clear).toHaveBeenCalled()
    clear.mockRestore()
  })
})

describe('Conclusion', () => {
  it('joins the explanation and the action', () => {
    const { container } = renderWithProviders(<Conclusion explanation="Because." action="Do this" />)

    expect(container.textContent).toBe('Because. Do this')
  })

  it('shows either part alone', () => {
    const { container, rerender } = renderWithProviders(<Conclusion explanation="Because." action="" />)

    expect(container.textContent).toBe('Because.')
    rerender(<Conclusion explanation="" action="Do this" />)
    expect(container.textContent).toBe('Do this')
  })

  it('renders nothing when both are empty', () => {
    const { container } = renderWithProviders(<Conclusion explanation="" action="" />)

    expect(container).toBeEmptyDOMElement()
  })
})

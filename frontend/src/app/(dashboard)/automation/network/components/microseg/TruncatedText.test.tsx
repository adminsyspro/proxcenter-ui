import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import TruncatedText from './TruncatedText'

function mockLayout(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
}

afterEach(() => {
  cleanup()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
})

describe('TruncatedText', () => {
  it('renders the text and applies the outer sx to the wrapper', () => {
    render(<TruncatedText text='web' data-testid='t' sx={{ flex: '1 1 0', width: 123 }} />)
    const el = screen.getByTestId('t')
    expect(el).toHaveTextContent('web')
    expect(el.parentElement).toHaveStyle({ width: '123px', minWidth: '0' })
  })

  it('shows the tooltip on hover when the layout is not measurable', async () => {
    render(<TruncatedText text='web' title='full web' />)
    fireEvent.mouseOver(screen.getByText('web'))
    expect(await screen.findByText('full web')).toBeInTheDocument()
  })

  it('shows the tooltip when the text is cut', async () => {
    mockLayout(300, 100)
    render(<TruncatedText text='a long name' />)
    const el = screen.getByText('a long name')
    fireEvent.mouseOver(el)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('a long name')
  })

  it('does not show the tooltip when the text fits', async () => {
    mockLayout(100, 100)
    render(<TruncatedText text='short' />)
    const el = screen.getByText('short')
    fireEvent.mouseOver(el)
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

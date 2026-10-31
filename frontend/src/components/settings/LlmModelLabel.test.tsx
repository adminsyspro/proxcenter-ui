import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { modelVendor } from '@/lib/ai/modelVendor'

import LlmModelLabel from './LlmModelLabel'

afterEach(cleanup)

describe('LlmModelLabel', () => {
  it('leads the model name with its vendor logo, hidden from screen readers', () => {
    const { container } = render(<LlmModelLabel model='qwen3.5:9b' />)
    const logo = container.querySelector('i')!

    expect(screen.getByText('qwen3.5:9b')).toBeTruthy()
    expect(logo.className).toContain(modelVendor('qwen3.5:9b').icon)
    expect(logo.dataset.vendor).toBe(modelVendor('qwen3.5:9b').vendor)
    expect(logo.parentElement?.getAttribute('aria-hidden')).toBe('true')
  })

  it('shows the children in place of the name, and a generic chip for an unknown model', () => {
    const { container } = render(<LlmModelLabel model='my-own-model'>My model (4 GB)</LlmModelLabel>)

    expect(screen.getByText('My model (4 GB)')).toBeTruthy()
    expect(screen.queryByText('my-own-model')).toBeNull()
    expect(container.querySelector('i')!.dataset.vendor).toBe('generic')
  })
})

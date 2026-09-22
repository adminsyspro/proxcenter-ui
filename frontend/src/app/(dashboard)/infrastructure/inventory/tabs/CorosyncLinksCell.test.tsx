import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import CorosyncLinksCell from './CorosyncLinksCell'

afterEach(cleanup)

describe('CorosyncLinksCell', () => {
  it('shows a dash when the node has no corosync link', () => {
    render(<CorosyncLinksCell links={[]} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows a dash when the links are unknown', () => {
    render(<CorosyncLinksCell links={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows a single link bare, without a link number', () => {
    const { container } = render(<CorosyncLinksCell links={['10.10.10.1']} />)
    expect(screen.getByText('10.10.10.1')).toBeInTheDocument()
    expect(container.textContent).toBe('10.10.10.1')
  })

  it('numbers the links in order when the node has several', () => {
    const { container } = render(<CorosyncLinksCell links={['10.10.10.1', '10.10.11.1']} />)
    expect(container.textContent).toBe('link010.10.10.1link110.10.11.1')
  })
})

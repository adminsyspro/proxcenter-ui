import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

vi.mock('@xyflow/react', async () => (await import('./xyflowTestMock')).xyflowMock)

import { BoundaryNode } from './ZoneNode'

describe('the Outside box', () => {
  const render = (egress?: 'applied' | 'observed' | 'notApplied') => renderWithProviders(
    <BoundaryNode {...({ data: { kind: 'outside', egress } } as unknown as Parameters<typeof BoundaryNode>[0])} />,
  )

  afterEach(cleanup)

  it('says the outbound traffic is not controlled, without any version in the text', () => {
    render('notApplied')
    expect(screen.getByText('Outside')).toBeTruthy()
    expect(screen.getByText('outbound not controlled')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/v1/)
  })

  it('says it is observed, and says nothing once every flow to it is applied', () => {
    render('observed')
    expect(screen.getByText('outbound observed')).toBeTruthy()
    cleanup()
    render('applied')
    expect(screen.queryByText(/outbound/)).toBeNull()
  })
})

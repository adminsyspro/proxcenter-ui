import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import PagedRows from './PagedRows'

const rows = (n: number) => Array.from({ length: n }, (_, i) => `row-${i + 1}`)
const list = (items: string[]) => (
  <PagedRows items={items} testId="pager">{(item, i) => <div key={item} data-testid="row" data-index={i}>{item}</div>}</PagedRows>
)

describe('PagedRows', () => {
  afterEach(cleanup)

  it('shows a short list whole, without a pager', () => {
    renderWithProviders(list(rows(20)))
    expect(screen.getAllByTestId('row')).toHaveLength(20)
    expect(screen.queryByTestId('pager')).toBeNull()
  })

  it('pages a long list by 20 and keeps every row reachable', () => {
    renderWithProviders(list(rows(45)))
    expect(screen.getAllByTestId('row')).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    const last = screen.getAllByTestId('row')
    expect(last.map(r => r.textContent)).toEqual(['row-41', 'row-42', 'row-43', 'row-44', 'row-45'])
    expect(last[0]).toHaveAttribute('data-index', '40')
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

import AIMarkdown, { severityOf } from './AIMarkdown'

afterEach(cleanup)

// The answer of the lab recette (30/10/2026) that the old formatter printed
// as raw "##" and "| --- |" lines.
const ANSWER = [
  '# Infrastructure status',
  '',
  '## Hosts',
  '',
  '| Host | CPU | RAM |',
  '|------|----:|----:|',
  '| pve1 | 2.4% | 22.6% |',
  '| pve2 | 2.8% | 80.6% |',
  '',
  '## Alerts',
  '',
  '1. **[CRIT]** Ceph PVE-DR: HEALTH_ERR',
  '2. **[WARN]** Node pve2: high RAM (80.5%)',
  '',
  'Use `qm list` to check.'
].join('\n')

describe('AIMarkdown', () => {
  it('renders headings, a real table and lists instead of Markdown source', () => {
    const { container } = render(<AIMarkdown>{ANSWER}</AIMarkdown>)

    expect(container.querySelector('h3')?.textContent).toBe('Infrastructure status')
    expect([...container.querySelectorAll('h4')].map(h => h.textContent)).toEqual(['Hosts', 'Alerts'])
    expect(container.querySelectorAll('table tbody tr')).toHaveLength(2)
    expect(container.querySelectorAll('ol li')).toHaveLength(2)
    expect(container.textContent).not.toContain('##')
    expect(container.textContent).not.toContain('|')
  })

  it('keeps the column alignment the model asked for', () => {
    const { container } = render(<AIMarkdown>{ANSWER}</AIMarkdown>)
    const cpu = container.querySelector('tbody tr td:nth-child(2)') as HTMLElement

    expect(cpu.style.textAlign).toBe('right')
  })

  it('turns a severity tag into a badge and leaves other bold text alone', () => {
    const { container } = render(<AIMarkdown>{'**[CRIT]** Ceph down, **pve1** is fine'}</AIMarkdown>)

    expect(container.querySelector('.MuiChip-colorError')?.textContent).toBe('CRIT')
    expect(container.querySelector('strong')?.textContent).toBe('pve1')
  })

  it('never interprets raw HTML nor a javascript: link', () => {
    const { container } = render(
      <AIMarkdown>{'<img src=x onerror="alert(1)"> <script>alert(1)</script> [click](javascript:alert(1))'}</AIMarkdown>
    )

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')?.getAttribute('href') ?? '').toBe('')
  })

  it('opens http links in a new tab without handing over the opener', () => {
    const { container } = render(<AIMarkdown>{'[docs](https://docs.proxcenter.io)'}</AIMarkdown>)
    const link = container.querySelector('a')

    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders nothing for an empty answer', () => {
    const { container } = render(<AIMarkdown>{''}</AIMarkdown>)

    expect(container.textContent).toBe('')
  })
})

describe('severityOf', () => {
  it('maps the tags the models use to a colour', () => {
    expect(severityOf('[CRIT]')).toEqual({ label: 'CRIT', color: 'error' })
    expect(severityOf(['[WARNING]'])).toEqual({ label: 'WARNING', color: 'warning' })
    expect(severityOf('[OK]')).toEqual({ label: 'OK', color: 'success' })
  })

  it('ignores anything else', () => {
    expect(severityOf('[NOTE]')).toBeNull()
    expect(severityOf('CRIT')).toBeNull()
    expect(severityOf(['[CRIT]', ' more'])).toBeNull()
  })
})

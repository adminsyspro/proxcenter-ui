import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import en from '@/messages/en.json'

import AffinityRulesManager, { type AffinityRule } from './AffinityRulesManager'

afterEach(cleanup)

const rule = (over: Partial<AffinityRule>): AffinityRule => ({
  id: 'r1',
  name: 'Tag: web',
  type: 'anti-affinity',
  connectionId: 'c1',
  enabled: true,
  required: false,
  vmids: [],
  nodes: [],
  ...over
})

// The real messages: the counts are ICU strings with a <strong> tag, which
// plain t() refuses and renders as the bare key.
const renderRules = (rules: AffinityRule[]) =>
  render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>} onError={error => { throw error }}>
      <AffinityRulesManager
        rules={rules}
        vms={[]}
        nodes={[]}
        connectionId='c1'
        onCreateRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onDeleteRule={vi.fn()}
      />
    </NextIntlClientProvider>
  )

describe('AffinityRulesManager rule source notices', () => {
  it('counts the rules detected from tags, the count in bold', () => {
    renderRules([rule({ id: 't1', fromTag: true }), rule({ id: 't2', fromTag: true })])

    const count = screen.getByText('2', { selector: 'strong' })

    expect(count.parentElement?.textContent).toBe('2 rule(s) automatically detected via Proxmox tags')
  })

  it('counts the rules configured from pools, the count in bold', () => {
    renderRules([rule({ id: 'p1', fromPool: true })])

    const count = screen.getByText('1', { selector: 'strong' })

    expect(count.parentElement?.textContent).toBe('1 rule(s) configured via pools')
  })
})

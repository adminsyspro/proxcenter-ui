import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

import SettingsNav, { SETTINGS_NAV_GROUPS, groupSettingsTabs } from './SettingsNav'

const { mediaQuery } = vi.hoisted(() => ({ mediaQuery: { desktop: true } }))

vi.mock('@mui/material', async importOriginal => {
  const actual = await importOriginal<typeof import('@mui/material')>()

  return { ...actual, useMediaQuery: () => mediaQuery.desktop }
})

const tabs = [
  { name: 'connections', group: 'infrastructure', label: 'Connections', icon: 'ri-link' },
  { name: 'ldap', group: 'access', label: 'LDAP', icon: 'ri-server-line' },
  { name: 'vdc', group: 'infrastructure', label: 'Virtual Datacenters', icon: 'ri-cloud-line' },
  { name: 'appearance', group: 'personalization', label: 'Appearance', icon: 'ri-palette-line' },
]

afterEach(() => {
  cleanup()
  mediaQuery.desktop = true
})

describe('groupSettingsTabs', () => {
  it('buckets tabs in group order, keeping their index, and drops empty groups', () => {
    const groups = groupSettingsTabs(tabs)

    expect(groups.map(g => g.key)).toEqual(['infrastructure', 'access', 'personalization'])
    expect(groups[0].items.map(i => [i.tab.name, i.index])).toEqual([['connections', 0], ['vdc', 2]])
    expect(groups[1].items.map(i => i.index)).toEqual([1])
  })
})

describe('SettingsNav', () => {
  it('renders a grouped side list on desktop and selects by index', () => {
    const onChange = vi.fn()

    renderWithProviders(<SettingsNav tabs={tabs} value={2} onChange={onChange} />)

    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.getByText('Infrastructure')).toBeInTheDocument()
    expect(screen.queryByText('Monitoring')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Virtual Datacenters/ })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: /Appearance/ }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('falls back to the horizontal tab row below md', () => {
    mediaQuery.desktop = false
    const onChange = vi.fn()

    renderWithProviders(<SettingsNav tabs={tabs} value={0} onChange={onChange} />)

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)

    fireEvent.click(screen.getByRole('tab', { name: /LDAP/ }))
    expect(onChange).toHaveBeenCalledWith(1)
  })
})

describe('settings nav messages', () => {
  it.each(Object.entries({ en, fr, de, es, ko, 'zh-CN': zhCN }))('%s names every group', (_, messages) => {
    const settings = (messages as { settings: { navGroups: Record<string, string>; navAriaLabel: string } }).settings

    for (const key of SETTINGS_NAV_GROUPS) expect(settings.navGroups[key]).toBeTruthy()
    expect(settings.navAriaLabel).toBeTruthy()
  })
})

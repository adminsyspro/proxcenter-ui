import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import type { ComponentProps } from 'react'

import en from '@/messages/en.json'
import type { CephHealthIssue } from '@/lib/ceph/types'

import HealthRail from './HealthRail'

const theme = createTheme()
const NO_FLAGS = { flags: [], hostFlags: {}, osdFlags: {}, forbidden: false, loading: false }

const check = (name: string, severity: string, summary: string, detail: string[] = []): CephHealthIssue => ({
  name,
  severity,
  summary,
  detail: detail.map(message => ({ message })),
})

function renderRail(props: Partial<ComponentProps<typeof HealthRail>> = {}) {
  const onNavigate = vi.fn()
  const onEditFlags = vi.fn()

  render(
    <NextIntlClientProvider locale='en' messages={en as Record<string, unknown>}>
      <ThemeProvider theme={theme}>
        <HealthRail
          health={{ status: 'HEALTH_OK', checks: [] }}
          flags={NO_FLAGS}
          onNavigate={onNavigate}
          onEditFlags={onEditFlags}
          {...props}
        />
      </ThemeProvider>
    </NextIntlClientProvider>,
  )

  return { onNavigate, onEditFlags }
}

afterEach(cleanup)

describe('HealthRail', () => {
  it('leads the state block with the decorative Ceph logo, in the full and the folded rail', () => {
    renderRail({ health: { status: 'HEALTH_WARN', checks: [check('OSD_DOWN', 'HEALTH_WARN', 'x')] } })
    expect(screen.getByTestId('rail-logo')).toHaveAttribute('src', '/images/ceph-logo.svg')
    expect(screen.getByTestId('rail-logo')).toHaveAttribute('alt', '')
    cleanup()
    renderRail({ collapsible: true, health: { status: 'HEALTH_OK', checks: [] } })
    expect(screen.getByTestId('rail-logo')).toBeInTheDocument()
  })

  it('puts the global state on the title line, right of the logo and the title, in the full and the folded rail', () => {
    const onLine = () => {
      const logo = screen.getByTestId('rail-logo')
      const state = screen.getByTestId('rail-state')
      const line = state.parentElement as HTMLElement

      expect(line).toContainElement(logo)
      expect(line).toHaveTextContent(en.cephCockpit.rail.title)
      expect(state).toHaveStyle({ marginLeft: 'auto' })
      expect(logo.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      return line
    }

    renderRail({ health: { status: 'HEALTH_ERR', checks: [check('OSD_DOWN', 'HEALTH_ERR', 'x')] } })
    const line = onLine()

    expect(screen.getByTestId('rail-state')).toHaveTextContent(en.cephCockpit.health.HEALTH_ERR)
    // No counts / version line under the title.
    expect(line).not.toHaveTextContent('20.2.4')
    expect(screen.queryByText(/20\.2\.4/)).toBeNull()
    expect(screen.queryByText(/\d+ errors?/)).toBeNull()
    cleanup()
    renderRail({ collapsible: true, health: { status: 'HEALTH_OK', checks: [] } })
    onLine()
    expect(screen.getByTestId('rail-state')).toHaveTextContent(en.cephCockpit.health.HEALTH_OK)
  })

  it('fill: the card takes the height of its slot, the checks scroll inside and the flags foot sticks to the bottom', () => {
    renderRail({ fill: true, health: { status: 'HEALTH_WARN', checks: [check('OSD_DOWN', 'HEALTH_WARN', '1 osds down')] } })

    expect(screen.getByTestId('health-rail')).toHaveStyle({ height: '100%', display: 'flex', flexDirection: 'column' })
    expect(screen.getByTestId('rail-checks')).toHaveStyle({ flex: '1 1 auto', overflowY: 'auto' })
    expect(screen.getByTestId('rail-flags')).toHaveStyle({ marginTop: 'auto' })
  })

  it('without fill the card keeps its natural height', () => {
    renderRail({ health: { status: 'HEALTH_WARN', checks: [check('OSD_DOWN', 'HEALTH_WARN', '1 osds down')] } })

    expect(screen.getByTestId('health-rail')).not.toHaveStyle({ height: '100%' })
    expect(screen.getByTestId('rail-checks')).not.toHaveStyle({ overflowY: 'auto' })
  })

  it('rail groups errors before warnings and links to target', () => {
    const { onNavigate } = renderRail({
      health: {
        status: 'HEALTH_ERR',
        checks: [
          check('OSD_DOWN', 'HEALTH_WARN', '1 osds down'),
          check('PG_DAMAGED', 'HEALTH_ERR', 'Possible data damage: 1 pg inconsistent', ['pg 2.1f is active+clean+inconsistent, acting [1,0,2]']),
          check('POOL_NEAR_FULL', 'HEALTH_WARN', "1 pool(s) nearfull", ["pool 'ceph-vm' is nearfull"]),
        ],
      },
    })

    const codes = screen.getAllByTestId('rail-check').map(el => el.getAttribute('data-code'))

    expect(codes).toEqual(['PG_DAMAGED', 'OSD_DOWN', 'POOL_NEAR_FULL'])
    const groups = screen.getAllByTestId('rail-group').map(el => el.textContent)

    expect(groups).toEqual([en.cephCockpit.rail.errors, en.cephCockpit.rail.warnings])
    expect(screen.queryByText(/Ceph 20\.2\.4/)).toBeNull()

    const osdDown = screen.getAllByTestId('rail-check')[1]

    fireEvent.click(within(osdDown).getByTestId('rail-link'))
    expect(onNavigate).toHaveBeenCalledWith({ tab: 'osd', filter: 'down' })

    // The PG check points at the primary OSD of the damaged PG.
    expect(within(screen.getAllByTestId('rail-check')[0]).getByTestId('rail-link')).toHaveTextContent('osd.1')
  })

  it('rail without target has no link', () => {
    renderRail({
      health: { status: 'HEALTH_WARN', checks: [check('SOMETHING_NEW', 'HEALTH_WARN', 'a check the cockpit does not know')] },
    })

    const item = screen.getByTestId('rail-check')

    expect(item).toHaveTextContent('SOMETHING_NEW')
    expect(within(item).queryByTestId('rail-link')).toBeNull()
  })

  it('folds the detail lines under the check until asked', () => {
    renderRail({
      health: { status: 'HEALTH_WARN', checks: [check('OSD_FLAGS', 'HEALTH_WARN', '1 host has flags', ['host pve3 has flags noout'])] },
    })

    expect(screen.queryByText('host pve3 has flags noout')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.rail.showDetail }))
    expect(screen.getByText('host pve3 has flags noout')).toBeInTheDocument()
  })

  it('rail collapses to state and flags on HEALTH_OK', () => {
    const { onEditFlags } = renderRail({
      health: { status: 'HEALTH_OK', checks: [] },
      flags: { ...NO_FLAGS, hostFlags: { pve3: ['noout'] } },
    })

    expect(screen.getByTestId('rail-state')).toHaveTextContent(en.cephCockpit.health.HEALTH_OK)
    expect(screen.queryByTestId('rail-group')).toBeNull()
    expect(screen.queryByTestId('rail-check')).toBeNull()
    expect(screen.getByTestId('ceph-flag-group-pve3')).toHaveTextContent('noout')
    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.rail.editFlags }))
    expect(onEditFlags).toHaveBeenCalled()
  })

  it('says when no flag is set, and hides the editor without the right', () => {
    renderRail({ flags: { ...NO_FLAGS, forbidden: true } })

    expect(screen.queryByRole('button', { name: en.cephCockpit.rail.editFlags })).toBeNull()
  })

  it('folds the checks under the state on a narrow screen', async () => {
    renderRail({
      collapsible: true,
      health: { status: 'HEALTH_WARN', checks: [check('MON_DOWN', 'HEALTH_WARN', '1/3 mons down')] },
    })

    expect(screen.queryByTestId('rail-check')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.cephCockpit.rail.showChecks }))
    expect(await screen.findByTestId('rail-check')).toHaveAttribute('data-code', 'MON_DOWN')
  })

  it('lists checks of the same severity in a stable order whatever Ceph sent first', () => {
    const a = check('AUTH_INSECURE_SERVICE_TICKETS', 'HEALTH_ERR', 'tickets')
    const b = check('AUTH_INSECURE_SERVICE_KEY_TYPE', 'HEALTH_ERR', 'keys')
    const codes = () => screen.getAllByTestId('rail-check').map(el => el.getAttribute('data-code'))

    renderRail({ health: { status: 'HEALTH_ERR', checks: [a, b] } })
    const first = codes()

    cleanup()
    renderRail({ health: { status: 'HEALTH_ERR', checks: [b, a] } })
    expect(codes()).toEqual(first)
    expect(first).toEqual(['AUTH_INSECURE_SERVICE_KEY_TYPE', 'AUTH_INSECURE_SERVICE_TICKETS'])
  })
})


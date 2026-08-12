/**
 * Component tests for LogLevelSelect.tsx — the shared per-rule log level
 * picker introduced with the PVE `log` parameter support.
 *
 * What matters here is the contract every rule dialog now depends on:
 *   - the nine PVE levels are all offered, in the Proxmox order;
 *   - an absent, empty or unrecognised incoming value renders as `nolog`
 *     rather than an out-of-range MUI value (which shows an empty control);
 *   - picking a level hands the caller the raw PVE token, not a label;
 *   - `disabled` reaches the control, so a saving dialog cannot be edited.
 *
 * The label is asserted through the real English bundle (`firewall.logLevel`
 * = "Log level"), so a missing translation key fails the test. It cannot be
 * used to *find* the control: MUI's InputLabel here carries no `id` and the
 * Select no `labelId`, so the combobox has no accessible name — the same
 * limitation documented in CreateLxcDialog.test.tsx. This component renders
 * exactly one combobox, so `getByRole('combobox')` is unambiguous.
 *
 * Opening goes through `fireEvent.mouseDown`, the event MUI's Select listens
 * to, rather than userEvent.click: emotion's `Mui-disabled` rule sets
 * pointer-events to none and user-event refuses to click such a node, which
 * would make the disabled assertion pass for the wrong reason.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'

import LogLevelSelect from './LogLevelSelect'
import { LOG_LEVELS } from './logLevels'

const LABEL = 'Log level'

const trigger = () => screen.getByRole('combobox')

/** Open the dropdown and return its listbox. */
function openMenu() {
  fireEvent.mouseDown(trigger())

  return screen.getByRole('listbox')
}

describe('LogLevelSelect', () => {
  afterEach(cleanup)

  it('offers the nine PVE levels in the Proxmox order', () => {
    renderWithProviders(<LogLevelSelect value="nolog" onChange={vi.fn()} />)

    const options = within(openMenu()).getAllByRole('option')

    expect(options.map(o => o.textContent)).toEqual([
      'nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug',
    ])

    // Guards against the rendered list and the module drifting apart
    expect(options).toHaveLength(LOG_LEVELS.length)
  })

  it('labels the control from the translation bundle', () => {
    renderWithProviders(<LogLevelSelect value="info" onChange={vi.fn()} />)

    // Rendered twice by the outlined variant (label + notched-outline legend)
    expect(screen.getAllByText(LABEL).length).toBeGreaterThan(0)
  })

  it('shows the incoming level', () => {
    renderWithProviders(<LogLevelSelect value="warning" onChange={vi.fn()} />)
    expect(trigger()).toHaveTextContent('warning')
  })

  it('normalises a level PVE returned in mixed case or padded', () => {
    renderWithProviders(<LogLevelSelect value="  WARNING  " onChange={vi.fn()} />)
    expect(trigger()).toHaveTextContent('warning')
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['unknown', 'verbose'],
  ])('falls back to nolog when the value is %s', (_label, value) => {
    renderWithProviders(<LogLevelSelect value={value} onChange={vi.fn()} />)
    expect(trigger()).toHaveTextContent('nolog')
  })

  it('calls onChange with the raw PVE level when a level is picked', () => {
    const onChange = vi.fn()

    renderWithProviders(<LogLevelSelect value="nolog" onChange={onChange} />)

    fireEvent.click(within(openMenu()).getByRole('option', { name: 'warning' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('warning')
  })

  it('honours disabled: the control cannot be opened', () => {
    const onChange = vi.fn()

    renderWithProviders(<LogLevelSelect value="crit" onChange={onChange} disabled />)

    expect(trigger()).toHaveAttribute('aria-disabled', 'true')

    fireEvent.mouseDown(trigger())

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('is enabled by default', () => {
    renderWithProviders(<LogLevelSelect value="crit" onChange={vi.fn()} />)

    expect(trigger()).not.toHaveAttribute('aria-disabled')
    expect(within(openMenu()).getAllByRole('option')).not.toHaveLength(0)
  })
})

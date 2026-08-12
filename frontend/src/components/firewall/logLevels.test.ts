/**
 * Tests for the firewall log level constants and resolver (#682).
 *
 * The level list used to be duplicated (shared.tsx and VMRulesPanel), with
 * a third dialog hardcoding only four of the nine values, so the list is
 * asserted here as a contract: nine PVE levels, `nolog` first, no
 * duplicates. `resolveLogLevel` guards the `<Select>` value — PVE can
 * return nothing at all for a rule that was created without a log level,
 * and an out-of-range value makes MUI render an empty control.
 *
 * `formatLogLevel` is the read-only counterpart, used by the five rules
 * tables: it is asserted here so the `nolog` → `-` collapse stays in one
 * place instead of being re-derived in each table.
 */

import { describe, it, expect } from 'vitest'

import { LOG_LEVELS, DEFAULT_LOG_LEVEL, resolveLogLevel, formatLogLevel } from './logLevels'

describe('LOG_LEVELS', () => {
  it('lists the nine levels PVE accepts, with nolog first', () => {
    expect(LOG_LEVELS).toEqual(['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'])
  })

  it('contains no duplicate level', () => {
    expect(new Set(LOG_LEVELS).size).toBe(LOG_LEVELS.length)
  })

  it('defaults to a level that is part of the list', () => {
    expect(LOG_LEVELS).toContain(DEFAULT_LOG_LEVEL)
    expect(DEFAULT_LOG_LEVEL).toBe('nolog')
  })
})

describe('resolveLogLevel', () => {
  it('keeps every level PVE can return', () => {
    for (const level of LOG_LEVELS) {
      expect(resolveLogLevel(level)).toBe(level)
    }
  })

  it('falls back to nolog when the rule carries no log level', () => {
    expect(resolveLogLevel(undefined)).toBe('nolog')
    expect(resolveLogLevel(null)).toBe('nolog')
    expect(resolveLogLevel('')).toBe('nolog')
    expect(resolveLogLevel('   ')).toBe('nolog')
  })

  it('falls back to nolog on an unknown value instead of leaking it to the Select', () => {
    expect(resolveLogLevel('verbose')).toBe('nolog')
    expect(resolveLogLevel('WARN')).toBe('nolog')
    expect(resolveLogLevel('4')).toBe('nolog')
  })

  it('accepts a level PVE echoed back with different case or padding', () => {
    expect(resolveLogLevel('WARNING')).toBe('warning')
    expect(resolveLogLevel(' Info ')).toBe('info')
  })

  it('never resolves to an empty string, which PVE rejects', () => {
    for (const value of [undefined, null, '', ' ', 'nope', 'debug']) {
      expect(resolveLogLevel(value)).not.toBe('')
    }
  })
})

describe('formatLogLevel', () => {
  it('shows the level for every rule that actually logs', () => {
    for (const level of LOG_LEVELS.filter(l => l !== 'nolog')) {
      expect(formatLogLevel(level)).toBe(level)
    }
  })

  it('collapses nolog to a dash — it is the case for most rules', () => {
    expect(formatLogLevel('nolog')).toBe('-')
  })

  it('shows a dash when the rule carries no log level at all', () => {
    expect(formatLogLevel(undefined)).toBe('-')
    expect(formatLogLevel(null)).toBe('-')
    expect(formatLogLevel('')).toBe('-')
    expect(formatLogLevel('   ')).toBe('-')
  })

  it('shows a dash rather than an unknown value PVE echoed back', () => {
    expect(formatLogLevel('verbose')).toBe('-')
    expect(formatLogLevel('4')).toBe('-')
  })

  it('normalises case and padding like resolveLogLevel does', () => {
    expect(formatLogLevel('WARNING')).toBe('warning')
    expect(formatLogLevel(' Info ')).toBe('info')
    expect(formatLogLevel(' NOLOG ')).toBe('-')
  })

  it('never renders an empty cell', () => {
    for (const value of [undefined, null, '', ' ', 'nope', ...LOG_LEVELS]) {
      expect(formatLogLevel(value)).not.toBe('')
    }
  })
})

import { describe, expect, it } from 'vitest'

import { logClock, migrationLogText } from './migrationLogText'

const at = (h: number, m: number, s: number) => new Date(2026, 9, 18, h, m, s).toISOString()

describe('migrationLogText (roadmap#53)', () => {
  it('writes one line per entry: time, level, VM when given, message', () => {
    expect(migrationLogText([
      { ts: at(7, 5, 9), level: 'info', msg: 'Warm migration: planning', vmName: 'r53-src-1' },
      { ts: at(17, 45, 0), level: 'error', msg: 'Copy failed', vmName: 'r53-src-2' },
    ])).toBe('07:05:09 info [r53-src-1] Warm migration: planning\n17:45:00 error [r53-src-2] Copy failed')
  })

  it('leaves the VM out for a single migration and defaults the level', () => {
    expect(migrationLogText([{ ts: at(0, 0, 1), level: '', msg: 'x' }])).toBe('00:00:01 info x')
  })

  it('copes with an empty list and a bad timestamp', () => {
    expect(migrationLogText([])).toBe('')
    expect(logClock('nope')).toBe('--:--:--')
  })
})

describe('migrationLogText: phase headers (#1000)', () => {
  it('frames a step so it stands out in the copied text', () => {
    expect(migrationLogText([
      { ts: at(9, 0, 0), level: 'step', msg: 'Guest conversion' },
      { ts: at(9, 0, 1), level: 'step', msg: 'Cutover', vmName: 'r9' },
    ])).toBe('09:00:00 == Guest conversion ==\n09:00:01 == [r9] Cutover ==')
  })
})

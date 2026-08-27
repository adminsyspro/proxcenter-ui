/**
 * Unit tests for the notification recipient parser (ui#812).
 *
 * The reported bug: the Settings > Notifications field advertised commas but
 * swallowed them, and the semicolon that users fell back on was stored as a
 * single glued recipient the SMTP server rejects.
 */

import { describe, it, expect } from 'vitest'

import {
  formatRecipients,
  invalidRecipients,
  isValidRecipient,
  normalizeRecipients,
  parseRecipients,
} from './recipients'

describe('parseRecipients', () => {
  it('splits on commas', () => {
    expect(parseRecipients('admin@example.com, ops@example.com')).toEqual([
      'admin@example.com',
      'ops@example.com',
    ])
  })

  it('splits on semicolons, the separator Outlook users reach for', () => {
    expect(parseRecipients('admin@example.com; ops@example.com')).toEqual([
      'admin@example.com',
      'ops@example.com',
    ])
  })

  it('splits on newlines, so a multiline field accepts one address per line', () => {
    expect(parseRecipients('admin@example.com\nops@example.com\r\nnoc@example.com')).toEqual([
      'admin@example.com',
      'ops@example.com',
      'noc@example.com',
    ])
  })

  it('mixes separators and drops the empty slots a half-typed list leaves', () => {
    expect(parseRecipients('admin@example.com,; ops@example.com,,')).toEqual([
      'admin@example.com',
      'ops@example.com',
    ])
  })

  it('returns an empty list for empty, null and undefined input', () => {
    expect(parseRecipients('')).toEqual([])
    expect(parseRecipients('   ')).toEqual([])
    expect(parseRecipients(null)).toEqual([])
    expect(parseRecipients(undefined)).toEqual([])
  })
})

describe('formatRecipients', () => {
  it('renders the list the way the field displays it', () => {
    expect(formatRecipients(['a@example.com', 'b@example.com'])).toBe('a@example.com, b@example.com')
  })

  it('tolerates a missing list', () => {
    expect(formatRecipients(null)).toBe('')
    expect(formatRecipients(undefined)).toBe('')
  })

  it('round-trips through the parser', () => {
    const list = ['a@example.com', 'b@example.com']

    expect(parseRecipients(formatRecipients(list))).toEqual(list)
  })
})

describe('normalizeRecipients', () => {
  it('repairs a config saved before the field accepted commas', () => {
    expect(normalizeRecipients(['admin@example.com; ops@example.com'])).toEqual([
      'admin@example.com',
      'ops@example.com',
    ])
  })

  it('leaves an already clean list untouched', () => {
    const clean = ['admin@example.com', 'ops@example.com']

    expect(normalizeRecipients(clean)).toEqual(clean)
  })

  it('tolerates a missing list', () => {
    expect(normalizeRecipients(null)).toEqual([])
    expect(normalizeRecipients(undefined)).toEqual([])
  })
})

describe('isValidRecipient', () => {
  it('accepts internal addresses without a dotted domain', () => {
    expect(isValidRecipient('root@localhost')).toBe(true)
  })

  it('accepts a plus-addressed mailbox', () => {
    expect(isValidRecipient('ops+alerts@example.com')).toBe(true)
  })

  it('rejects shapes that cannot be an address', () => {
    expect(isValidRecipient('admin')).toBe(false)
    expect(isValidRecipient('admin@')).toBe(false)
    expect(isValidRecipient('@example.com')).toBe(false)
    expect(isValidRecipient('a@b@c')).toBe(false)
    expect(isValidRecipient('admin@example.com ops@example.com')).toBe(false)
    expect(isValidRecipient('')).toBe(false)
  })
})

describe('invalidRecipients', () => {
  it('reports only the entries that cannot be addresses', () => {
    expect(invalidRecipients(['admin@example.com', 'oops', 'root@localhost'])).toEqual(['oops'])
  })

  it('tolerates a missing list', () => {
    expect(invalidRecipients(null)).toEqual([])
  })
})

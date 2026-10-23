import { describe, expect, it } from 'vitest'

import { csvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('quotes a plain cell', () => {
    expect(csvCell('alice@x.io')).toBe('"alice@x.io"')
    expect(csvCell(42)).toBe('"42"')
  })

  it('doubles embedded quotes instead of breaking the line', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('renders null and undefined as an empty cell', () => {
    expect(csvCell(null)).toBe('""')
    expect(csvCell(undefined)).toBe('""')
  })

  it('neutralises a leading formula trigger with a quote prefix', () => {
    // The lab case: a failed login whose typed email starts with "=".
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`)
    expect(csvCell('+1+1')).toBe(`"'+1+1"`)
    expect(csvCell('-2+3')).toBe(`"'-2+3"`)
    expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`)
    expect(csvCell('\t=cmd')).toBe(`"'\t=cmd"`)
    expect(csvCell('\r=cmd')).toBe(`"'\r=cmd"`)
  })

  it('leaves a trigger character alone when it is not the first one', () => {
    expect(csvCell('a=b')).toBe('"a=b"')
    expect(csvCell('user@example.com')).toBe('"user@example.com"')
    // The em dash placeholder the page uses for empty columns is not a minus.
    expect(csvCell('—')).toBe('"—"')
  })
})

describe('toCsv', () => {
  it('joins quoted cells with commas and rows with newlines', () => {
    expect(toCsv([['Date', 'User'], ['2026-10-23', '=evil']])).toBe('"Date","User"\n"2026-10-23","\'=evil"')
  })
})
